import type { Logger } from './logger';

/**
 * Graceful shutdown (14_DevOps_Deployment_Runbook.md, deployment order step 4).
 *
 * ECS Fargate and DigitalOcean App Platform both stop a container by sending SIGTERM and then
 * SIGKILL after a grace period. Between those two signals the worker has to stop accepting
 * jobs, let the ones already running finish, and close its Redis and Postgres connections —
 * otherwise a rolling deploy tears a half-finished aggregation off mid-transaction and leaves
 * pool slots behind for the connection budget in packages/db to absorb.
 *
 * Steps run in registration order, so callers register intake-first: stop taking work, then
 * drain, then close connections.
 */

export interface ShutdownStep {
  name: string;
  run: () => Promise<void>;
}

export class ShutdownCoordinator {
  private readonly steps: ShutdownStep[] = [];
  private readonly controller = new AbortController();
  private started = false;

  constructor(
    private readonly logger: Logger,
    private readonly timeoutMs: number,
  ) {}

  /** Aborted the moment shutdown begins; long jobs poll it to stop between units of work. */
  get signal(): AbortSignal {
    return this.controller.signal;
  }

  register(step: ShutdownStep): void {
    this.steps.push(step);
  }

  /**
   * Installs signal handlers. A second signal while draining exits immediately — an operator
   * interrupting twice, or a platform escalating, means "stop now", and honouring that beats
   * appearing hung.
   */
  listen(
    onExit: (code: number) => void,
    signals: readonly NodeJS.Signals[] = ['SIGTERM', 'SIGINT'],
  ): void {
    for (const signal of signals) {
      process.on(signal, () => {
        if (this.started) {
          this.logger.warn('second signal during shutdown, exiting immediately', { signal });
          onExit(1);
          return;
        }
        void this.shutdown(signal).then(onExit);
      });
    }
  }

  async shutdown(reason: string): Promise<number> {
    if (this.started) return 0;
    this.started = true;
    this.controller.abort();
    this.logger.info('shutdown started', { reason, steps: this.steps.length });

    const startedAt = Date.now();
    let timer: NodeJS.Timeout | undefined;

    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => {
        resolve('timeout');
      }, this.timeoutMs);
      // The timer must not keep the process alive once every step has finished.
      timer.unref();
    });

    const outcome = await Promise.race([this.runSteps(), timeout]);
    if (timer) clearTimeout(timer);

    if (outcome === 'timeout') {
      this.logger.error(
        'shutdown timed out with steps outstanding',
        new Error(`shutdown exceeded ${this.timeoutMs}ms`),
        { reason, elapsedMs: Date.now() - startedAt },
      );
      return 1;
    }

    this.logger.info('shutdown complete', { reason, elapsedMs: Date.now() - startedAt });
    return outcome;
  }

  /**
   * A failing step never aborts the rest: a Redis connection that has already gone must not
   * stop the Postgres pool from closing. Failures are logged and produce a non-zero exit so
   * the platform records an unclean stop.
   */
  private async runSteps(): Promise<number> {
    let exitCode = 0;

    for (const step of this.steps) {
      const startedAt = Date.now();
      try {
        await step.run();
        this.logger.debug('shutdown step complete', {
          step: step.name,
          elapsedMs: Date.now() - startedAt,
        });
      } catch (error) {
        exitCode = 1;
        this.logger.error('shutdown step failed', error, { step: step.name });
      }
    }

    return exitCode;
  }
}

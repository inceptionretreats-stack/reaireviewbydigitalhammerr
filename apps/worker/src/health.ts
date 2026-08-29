import { createServer, type Server } from 'node:http';
import type { Logger } from './logger';

/**
 * Health signal for the container platform.
 *
 * A worker serves no traffic, so there is nothing for a load balancer to probe; what ECS and
 * DigitalOcean both need is a container health check that answers "is this process still the
 * one that should be receiving work". That is the whole contract here:
 *
 *   200 while running, 503 once SIGTERM has started the drain.
 *
 * Deliberately NOT unhealthy on a stale or failing job. Restarting the container does not fix
 * a broken daily rollup — it aborts whatever else is in flight and loses the diagnostic state —
 * so job freshness is reported in the body for alerting (the runbook alerts on queue retry
 * exhaustion, not on liveness) and never gates the status code.
 */

export interface JobHealth {
  lastStartedAt: string | null;
  lastSucceededAt: string | null;
  lastFailedAt: string | null;
  lastDurationMs: number | null;
  consecutiveFailures: number;
}

export interface HealthSnapshot {
  status: 'ok' | 'draining';
  startedAt: string;
  uptimeSeconds: number;
  jobs: Record<string, JobHealth>;
}

export class HealthState {
  private draining = false;
  private readonly startedAt = new Date();
  private readonly jobs = new Map<string, JobHealth>();

  markStarted(jobName: string): void {
    this.entry(jobName).lastStartedAt = new Date().toISOString();
  }

  markSucceeded(jobName: string, durationMs: number): void {
    const entry = this.entry(jobName);
    entry.lastSucceededAt = new Date().toISOString();
    entry.lastDurationMs = durationMs;
    entry.consecutiveFailures = 0;
  }

  markFailed(jobName: string, durationMs: number): void {
    const entry = this.entry(jobName);
    entry.lastFailedAt = new Date().toISOString();
    entry.lastDurationMs = durationMs;
    entry.consecutiveFailures += 1;
  }

  beginDraining(): void {
    this.draining = true;
  }

  get isDraining(): boolean {
    return this.draining;
  }

  snapshot(): HealthSnapshot {
    return {
      status: this.draining ? 'draining' : 'ok',
      startedAt: this.startedAt.toISOString(),
      uptimeSeconds: Math.floor((Date.now() - this.startedAt.getTime()) / 1000),
      jobs: Object.fromEntries(this.jobs),
    };
  }

  private entry(jobName: string): JobHealth {
    const existing = this.jobs.get(jobName);
    if (existing) return existing;

    const created: JobHealth = {
      lastStartedAt: null,
      lastSucceededAt: null,
      lastFailedAt: null,
      lastDurationMs: null,
      consecutiveFailures: 0,
    };
    this.jobs.set(jobName, created);
    return created;
  }
}

export interface HealthServer {
  close(): Promise<void>;
}

/** Returns null when the port is 0, which disables the listener (local runs, tests). */
export function startHealthServer(
  port: number,
  state: HealthState,
  logger: Logger,
): HealthServer | null {
  if (port === 0) {
    logger.info('health listener disabled', { port });
    return null;
  }

  const server: Server = createServer((request, response) => {
    const body = JSON.stringify(state.snapshot());
    response.writeHead(state.isDraining ? 503 : 200, {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
      // A cached health response describes a process that may no longer exist.
      'cache-control': 'no-store',
    });
    response.end(request.method === 'HEAD' ? undefined : body);
  });

  server.listen(port, () => {
    logger.info('health listener started', { port });
  });

  server.on('error', (error) => {
    logger.error('health listener failed', error, { port });
  });

  return {
    close: () =>
      new Promise<void>((resolve) => {
        // closeAllConnections, or a keep-alive health check holds the drain open for the full
        // shutdown timeout.
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  };
}

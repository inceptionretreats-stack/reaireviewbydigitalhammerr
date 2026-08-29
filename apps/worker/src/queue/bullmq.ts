import { Queue, Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import type { HealthState } from '../health';
import type { Logger } from '../logger';
import type { JobHandler, JobSummary } from '../jobs/types';
import { WORKER_QUEUE_NAME, type ScheduleSpec } from './names';
import type { JobSchedulerPort } from './scheduler';

/**
 * The only module that knows BullMQ exists.
 *
 * Everything else in the worker talks to JobHandler and JobSchedulerPort, which is what keeps
 * the four jobs testable with no Redis and makes the queue backplane replaceable — the runbook
 * lists Redis as "queue backplane", explicitly not a source of truth.
 */

export interface ScheduledJobPayload {
  readonly scheduledBy?: string;
}

export interface QueueRuntimeOptions {
  redisUrl: string;
  /** Key namespace. Distinct per environment so staging cannot drain production's queue. */
  prefix: string;
  concurrency: number;
  logger: Logger;
  health: HealthState;
  /** Aborted on SIGTERM and handed to every job, so long loops can stop between units. */
  signal: AbortSignal;
  handlers: readonly JobHandler[];
}

export class BullMqRuntime implements JobSchedulerPort {
  private readonly queueConnection: Redis;
  private readonly workerConnection: Redis;
  private readonly queue: Queue<ScheduledJobPayload, JobSummary, string>;
  private readonly worker: Worker<ScheduledJobPayload, JobSummary, string>;
  private readonly handlers: Map<string, JobHandler>;

  constructor(private readonly options: QueueRuntimeOptions) {
    this.handlers = new Map(options.handlers.map((handler) => [handler.name, handler]));

    // Two connections on purpose: a BullMQ Worker holds a blocking connection, and sharing it
    // with the Queue would stall every enqueue behind the block.
    this.queueConnection = createConnection(options.redisUrl);
    this.workerConnection = createConnection(options.redisUrl);

    this.queue = new Queue<ScheduledJobPayload, JobSummary, string>(WORKER_QUEUE_NAME, {
      connection: this.queueConnection,
      prefix: options.prefix,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 30_000 },
        // Keep a week of successes for the runbook's queue-age metric, a month of failures for
        // post-mortems; without these the Redis keyspace grows without bound.
        removeOnComplete: { age: 7 * 24 * 3600, count: 500 },
        removeOnFail: { age: 30 * 24 * 3600 },
      },
    });

    this.worker = new Worker<ScheduledJobPayload, JobSummary, string>(
      WORKER_QUEUE_NAME,
      (job) => this.dispatch(job),
      {
        connection: this.workerConnection,
        prefix: options.prefix,
        concurrency: options.concurrency,
      },
    );

    this.worker.on('failed', (job, error) => {
      options.logger.error('job failed', error, {
        job: job?.name ?? 'unknown',
        jobId: job?.id ?? null,
        attempt: job?.attemptsMade ?? 0,
      });
    });

    this.worker.on('error', (error) => {
      // Connection-level, not job-level. Never fatal: BullMQ reconnects, and exiting here
      // would turn a Redis blip into a container restart loop.
      options.logger.error('queue connection error', error);
    });
  }

  private async dispatch(job: Job<ScheduledJobPayload, JobSummary, string>): Promise<JobSummary> {
    const handler = this.handlers.get(job.name);
    if (!handler) {
      // A schedule survived in Redis for a handler this build no longer has. Reconciliation at
      // boot removes those, so reaching here means a job was enqueued by something else.
      throw new Error(`No handler registered for job ${job.name}`);
    }

    const logger = this.options.logger.child({ job: job.name, jobId: job.id ?? null });
    const startedAt = Date.now();
    this.options.health.markStarted(job.name);
    logger.info('job started', { attempt: job.attemptsMade + 1 });

    try {
      const summary = await handler.run({
        logger,
        now: new Date(),
        signal: this.options.signal,
        attempt: job.attemptsMade + 1,
      });

      const durationMs = Date.now() - startedAt;
      this.options.health.markSucceeded(job.name, durationMs);
      logger.info('job finished', { durationMs, ...summary });
      return summary;
    } catch (error) {
      this.options.health.markFailed(job.name, Date.now() - startedAt);
      throw error;
    }
  }

  async upsert(spec: ScheduleSpec): Promise<void> {
    await this.queue.upsertJobScheduler(
      spec.id,
      { pattern: spec.cron, tz: spec.timeZone },
      { name: spec.jobName, data: { scheduledBy: spec.id } },
    );
  }

  async listScheduleIds(): Promise<string[]> {
    const schedulers = await this.queue.getJobSchedulers();
    return schedulers
      .map((scheduler) => scheduler.key)
      .filter((key): key is string => typeof key === 'string');
  }

  async remove(id: string): Promise<void> {
    await this.queue.removeJobScheduler(id);
  }

  /**
   * Stops accepting work and waits for running jobs. Called first during shutdown so the
   * remaining steps are closing idle connections rather than yanking live ones.
   */
  async stopAcceptingWork(): Promise<void> {
    await this.worker.close();
  }

  async closeConnections(): Promise<void> {
    await this.queue.close();
    await this.queueConnection.quit();
    await this.workerConnection.quit();
  }
}

function createConnection(redisUrl: string): Redis {
  return new Redis(redisUrl, {
    // Required by BullMQ: its blocking commands must not be aborted by the retry limiter.
    maxRetriesPerRequest: null,
  });
}

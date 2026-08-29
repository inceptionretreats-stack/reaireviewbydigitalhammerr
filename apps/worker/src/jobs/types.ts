import type { Logger } from '../logger';

/**
 * The contract every scheduled job implements.
 *
 * Handlers take their collaborators by constructor injection and their clock from the context,
 * which is what makes the date-sensitive ones (the daily rollup, the retention window)
 * testable without a database and without freezing global time.
 */

export type JobSummaryValue = string | number | boolean | null;

/** Returned to BullMQ and echoed into the completion log, so keep it small and factual. */
export type JobSummary = Record<string, JobSummaryValue>;

export interface JobContext {
  readonly logger: Logger;
  /** Injected rather than read from Date.now() inside handlers, so tests can pin it. */
  readonly now: Date;
  /** Aborted on SIGTERM. Long loops must check it between units of work. */
  readonly signal: AbortSignal;
  readonly attempt: number;
}

export interface JobHandler {
  readonly name: string;
  run(context: JobContext): Promise<JobSummary>;
}

export class JobAbortedError extends Error {
  constructor(jobName: string) {
    super(`Job ${jobName} stopped early because the worker is shutting down`);
    this.name = 'JobAbortedError';
  }
}

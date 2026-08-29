import type { Logger } from '../logger';
import type { ScheduleSpec } from './names';

/**
 * Scheduling port.
 *
 * Everything the worker needs from BullMQ's repeatable-job machinery is these three calls, so
 * the BullMQ surface lives behind them (queue/bullmq.ts) and the reconciliation logic below —
 * the part with the interesting failure mode — is testable against MemoryJobScheduler,
 * mirroring the MemoryQuotaStore / PostgresQuotaStore split in packages/core.
 */
export interface JobSchedulerPort {
  upsert(spec: ScheduleSpec): Promise<void>;
  listScheduleIds(): Promise<string[]>;
  remove(id: string): Promise<void>;
}

export interface ReconcileResult {
  upserted: string[];
  removed: string[];
}

/**
 * Declares the schedule table as the single source of truth.
 *
 * The pruning half is the point. Repeatable schedules live in Redis, not in the deployment, so
 * a job that is renamed or retired keeps firing from its old key forever — against a handler
 * that no longer exists — until something removes it. Reconciling on every boot means the code
 * always wins.
 */
export async function reconcileSchedules(
  scheduler: JobSchedulerPort,
  specs: readonly ScheduleSpec[],
  logger: Logger,
): Promise<ReconcileResult> {
  const wanted = new Set(specs.map((spec) => spec.id));

  for (const spec of specs) {
    await scheduler.upsert(spec);
    logger.info('schedule registered', {
      schedule: spec.id,
      job: spec.jobName,
      cron: spec.cron,
      timeZone: spec.timeZone,
    });
  }

  const removed: string[] = [];
  for (const existing of await scheduler.listScheduleIds()) {
    if (wanted.has(existing)) continue;
    await scheduler.remove(existing);
    removed.push(existing);
    logger.warn('stale schedule removed', { schedule: existing });
  }

  return { upserted: specs.map((spec) => spec.id), removed };
}

/** In-memory scheduler for tests and for a --dry-run boot that must not touch Redis. */
export class MemoryJobScheduler implements JobSchedulerPort {
  private readonly schedules = new Map<string, ScheduleSpec>();

  seed(spec: ScheduleSpec): void {
    this.schedules.set(spec.id, spec);
  }

  upsert(spec: ScheduleSpec): Promise<void> {
    this.schedules.set(spec.id, spec);
    return Promise.resolve();
  }

  listScheduleIds(): Promise<string[]> {
    return Promise.resolve([...this.schedules.keys()]);
  }

  remove(id: string): Promise<void> {
    this.schedules.delete(id);
    return Promise.resolve();
  }

  get size(): number {
    return this.schedules.size;
  }

  has(id: string): boolean {
    return this.schedules.has(id);
  }
}

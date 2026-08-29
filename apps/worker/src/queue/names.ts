/**
 * Queue identity and schedule table.
 *
 * 02_System_Architecture.md gives the worker four responsibilities; all four run on one queue
 * because they are low-frequency maintenance work and a single queue keeps the depth/age
 * metric in the runbook meaningful. Split only when one job's latency starts mattering to
 * another's.
 */

export const WORKER_QUEUE_NAME = 'maintenance';

export const JOB_NAMES = {
  analyticsDailyRollup: 'analytics.daily-rollup',
  analyticsPartitionMaintenance: 'analytics.partition-maintenance',
  sessionPurge: 'auth.session-purge',
  customDomainPoll: 'domains.status-poll',
} as const;

export type JobName = (typeof JOB_NAMES)[keyof typeof JOB_NAMES];

/**
 * Cron schedules are pinned to UTC.
 *
 * A container image inherits whatever timezone the base image has, and a cron that silently
 * shifts by 5h30m after a base-image bump is the kind of outage found weeks later. Note this
 * is the *trigger* timezone only — the business-local day boundary that AC-026 requires is a
 * separate, per-tenant calculation inside the rollup itself (see jobs/analytics/date-bucket).
 */
export const SCHEDULE_TIME_ZONE = 'Etc/UTC';

export interface ScheduleSpec {
  /** Stable id. Changing it orphans the old schedule, which reconcileSchedules then prunes. */
  readonly id: string;
  readonly jobName: JobName;
  readonly cron: string;
  readonly timeZone: string;
  readonly why: string;
}

export const SCHEDULES: readonly ScheduleSpec[] = [
  {
    id: 'analytics-daily-rollup-v1',
    jobName: JOB_NAMES.analyticsDailyRollup,
    // 00:20 UTC. Every business-local day that the job rolls up is already complete at this
    // instant for every timezone on earth, because it only ever aggregates days strictly
    // before the tenant's current local date.
    cron: '20 0 * * *',
    timeZone: SCHEDULE_TIME_ZONE,
    why: 'Precomputed dashboard aggregates (ADR-005, AN-01).',
  },
  {
    id: 'analytics-partition-maintenance-v1',
    jobName: JOB_NAMES.analyticsPartitionMaintenance,
    // Daily, not monthly. Monthly maintenance has exactly twelve chances a year to run, and a
    // missed one silently starts filling the DEFAULT partition (AMENDMENT-012).
    cron: '10 3 * * *',
    timeZone: SCHEDULE_TIME_ZONE,
    why: 'Pre-create partitions ahead of need and enforce 13-month retention.',
  },
  {
    id: 'session-purge-v1',
    jobName: JOB_NAMES.sessionPurge,
    cron: '40 * * * *',
    timeZone: SCHEDULE_TIME_ZONE,
    why: 'Storage hygiene for expired sessions (AMENDMENT-001).',
  },
  {
    id: 'custom-domain-poll-v1',
    jobName: JOB_NAMES.customDomainPoll,
    // DNS delegation and certificate issuance are minutes-scale, so is this.
    cron: '*/5 * * * *',
    timeZone: SCHEDULE_TIME_ZONE,
    why: 'Advance PENDING_DNS/PENDING_SSL hostnames (DOM-01, ADR-009).',
  },
];

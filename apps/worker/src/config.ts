import { loadEnv, type Env } from '@ai-review/config';
import { z } from 'zod';

/**
 * Worker configuration.
 *
 * Everything defined by `15_Environment_Variables.example` comes from `loadEnv()`, unchanged,
 * so the worker fails at boot in exactly the way the web service does on a missing secret
 * rather than surfacing it mid-job.
 *
 * The `WORKER_*` knobs below are NOT in that file. Adding them to `packages/config` would
 * change the delivered environment contract, which is a specification change this module is
 * not entitled to make on its own, so they are parsed here — once, at boot, with the same zod
 * discipline — and every one has a safe default so an unset variable is never a boot failure.
 * If they earn a permanent place they should be promoted into the shared schema and into
 * file 15 together.
 */

const bool = (fallback: boolean) =>
  z
    .enum(['true', 'false', '1', '0'])
    .default(fallback ? 'true' : 'false')
    .transform((value) => value === 'true' || value === '1');

const workerEnvSchema = z.object({
  /** BullMQ key namespace. Distinct per environment so staging can never drain production. */
  WORKER_QUEUE_PREFIX: z.string().min(1).max(60).default('ai-review'),

  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(4),

  /** ECS/DigitalOcean container health check target. 0 disables the listener. */
  WORKER_HEALTH_PORT: z.coerce.number().int().min(0).max(65535).default(8081),

  /**
   * Must stay below the orchestrator's stop timeout (ECS `stopTimeout`, default 30s) or the
   * platform sends SIGKILL mid-job and the graceful path never runs.
   */
  WORKER_SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(25_000),

  /**
   * How many completed business-local days each daily rollup recomputes. Greater than 1
   * because events can arrive late (02_System_Architecture.md allows the analytics pipeline to
   * queue and retry), and the rollup is idempotent, so recomputing yesterday-but-one is free
   * insurance rather than double counting.
   */
  WORKER_ANALYTICS_LOOKBACK_DAYS: z.coerce.number().int().min(1).max(31).default(2),

  /** Months of analytics_events partitions kept ahead of "now" (AMENDMENT-012). */
  WORKER_PARTITION_MONTHS_AHEAD: z.coerce.number().int().min(1).max(12).default(3),

  /** 13_Security_Privacy_Compliance.md: anonymous raw event data, 13 months by default. */
  WORKER_ANALYTICS_RETENTION_MONTHS: z.coerce.number().int().min(2).max(120).default(13),

  /**
   * Retention DROPs are opt-in, and default OFF.
   *
   * Dropping a partition is irreversible and the failure mode is silent — nobody notices
   * missing history until a dashboard is asked for it. With this off the job still runs and
   * logs exactly which partitions it *would* drop, so operations enable it against evidence.
   *
   * Leaving it off indefinitely means the 13-month retention obligation is not actually being
   * met, which is a compliance gap, not a safe steady state. It is meant to be turned on.
   */
  WORKER_PARTITION_DROP_ENABLED: bool(false),

  /**
   * Blast radius cap. A correct run drops at most one partition per month, so anything above
   * 1 only ever helps a backlog — and caps the damage if the cutoff maths is ever wrong.
   */
  WORKER_MAX_PARTITION_DROPS_PER_RUN: z.coerce.number().int().min(0).max(12).default(1),

  /**
   * Expired sessions are already unusable via SessionService.resolve, so purging is storage
   * hygiene rather than a security control. A short tail is kept so SET-01's device list can
   * still show a session that expired this week.
   */
  WORKER_SESSION_PURGE_GRACE_DAYS: z.coerce.number().int().min(0).max(365).default(7),

  /** Custom domains examined per polling run (DOM-01). */
  WORKER_DOMAIN_POLL_BATCH: z.coerce.number().int().min(1).max(500).default(50),
});

export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export interface WorkerConfig {
  readonly env: Env;
  readonly worker: WorkerEnv;
}

export class WorkerConfigError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid worker configuration:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`);
    this.name = 'WorkerConfigError';
  }
}

export function loadWorkerConfig(source: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const env = loadEnv(source);
  const result = workerEnvSchema.safeParse(source);

  if (!result.success) {
    throw new WorkerConfigError(
      result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    );
  }

  return { env, worker: result.data };
}

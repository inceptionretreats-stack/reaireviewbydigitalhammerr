# apps/worker — standalone BullMQ worker

This is an optional background process that runs scheduled maintenance jobs from a BullMQ queue
in Redis. Read this before running it, before changing a maintenance job, or when you wonder how
the same maintenance happens in production without it. **It is not deployed on Vercel.**
Production maintenance runs through Vercel Cron in `apps/web` (see below).

## What it does

One queue (`maintenance`) with four repeatable jobs, all scheduled in UTC (`src/queue/names.ts`):

| Job name                          | Schedule (UTC)  | Folder                 | Does                                                      |
| --------------------------------- | --------------- | ---------------------- | --------------------------------------------------------- |
| `analytics.daily-rollup`          | 00:20 daily     | `src/jobs/analytics/`  | Daily per-business totals into `analytics_daily_business` |
| `analytics.partition-maintenance` | 03:10 daily     | `src/jobs/partitions/` | Creates future monthly `analytics_events` partitions      |
| `auth.session-purge`              | hourly at :40   | `src/jobs/sessions/`   | Deletes expired sessions after a grace period             |
| `domains.status-poll`             | every 5 minutes | `src/jobs/domains/`    | Checks pending custom domains                             |

Notes: the rollup counts by each business's local day. Partition maintenance can also drop
partitions past the retention window, but only when `WORKER_PARTITION_DROP_ENABLED` is on (off by
default; a drop is irreversible). The domain poll has no provider adapter yet
(`UnconfiguredCustomDomainProvider`), so every check fails fast and is logged.

## Layout

- `src/index.ts`: entry point and composition root. Loads config, creates the database, the jobs
  and the BullMQ runtime, starts the health server and registers shutdown steps.
- `src/config.ts`: `loadWorkerConfig()`, the shared `loadEnv()` plus the worker's own `WORKER_*`
  schema.
- `src/queue/`: `names.ts` (queue name, job names, schedule table), `scheduler.ts` (upserts the
  schedules and prunes stale ones), `bullmq.ts` (the only file that knows BullMQ exists).
- `src/jobs/<domain>/`: one folder per job; `src/jobs/types.ts` is the `JobHandler` contract.
- `src/health.ts`: HTTP health check, 200 while running and 503 once shutdown starts.
- `src/shutdown.ts`: SIGTERM drain. Stop taking work, let running jobs finish, close connections.
- `src/logger.ts`: one JSON object per log line on stdout.
- `src/maintenance.ts`: side-effect-free helpers exported for `apps/web` (see below).
- `src/__tests__/`: unit tests, run by `pnpm test`; `support/harness.ts` captures log lines.

Each job folder follows the same split:

- `store.ts`: the Postgres implementation (for example `PostgresAnalyticsAggregationStore`).
- `memory-store.ts`: an in-memory double with the same interface, used by the tests.
- Pure helpers with no I/O (`analytics/date-bucket.ts`, `analytics/metrics.ts`,
  `partitions/window.ts`), so date and retention logic is tested without a database.
- The job itself (`aggregate.ts`, `maintain.ts`, `purge.ts`, `poll.ts`). `sessions/` has only the
  job, which uses `SessionService` from `@ai-review/core`; `domains/provider.ts` is the port a
  custom-hostname provider adapter will implement.

## How production does this without the worker

`vercel.json` in `apps/web` schedules `GET /api/cron/maintenance` daily at 03:10 UTC. The route
(`apps/web/app/api/cron/maintenance/route.ts`) runs `apps/web/lib/cron/maintenance.ts` with
`apps/web/lib/cron/maintenance-store.ts`, which imports the worker's helpers through the package's
only export:

```ts
import { PostgresPartitionStore /* … */ } from '@ai-review/worker/maintenance';
```

That path covers the analytics rollup, partition creation and the session purge, checkpointing
progress in the `maintenance_jobs` table so a short serverless run can resume. It never drops
partitions and does not poll custom domains. `src/maintenance.ts` must stay free of side effects:
never import `src/index.ts` from `apps/web`.

Do not run the worker and the cron path against the same database without deciding which one owns
maintenance. The other Vercel Cron jobs (subscriptions, health) are described in
[docs/operations/email-and-scheduled-jobs.md](../../docs/operations/email-and-scheduled-jobs.md).

## Running it

| Command                                 | Does                                                             |
| --------------------------------------- | ---------------------------------------------------------------- |
| `pnpm --filter @ai-review/worker dev`   | `tsx watch src/index.ts` (restarts on change)                    |
| `pnpm --filter @ai-review/worker start` | `tsx src/index.ts`                                               |
| `pnpm dev` (repo root)                  | Runs the `dev` scripts of `apps/web` and this worker in parallel |

Two things to know first:

- It needs a reachable **Redis** (`REDIS_URL`) and **PostgreSQL**. The local dev scripts do not
  start Redis.
- It reads `process.env` only and does **not** load the root `.env` (`apps/web` does, in
  `next.config.ts`). Export the variables first, or start it from `apps/worker` with
  `node --env-file=../../.env --run dev`. If you only need the web app, run
  `pnpm --filter @ai-review/web dev` instead of `pnpm dev`.

## Environment (names only)

- **Required by the shared schema** (`@ai-review/config`, which the worker validates at boot):
  `APP_BASE_URL`, `API_BASE_URL`, `SESSION_SECRET`, `APP_ENCRYPTION_KEY`, `HASH_PEPPER`,
  `DATABASE_URL`, `REDIS_URL`, `S3_BUCKET`, `EMAIL_FROM`. With `NODE_ENV=production` the schema
  also requires `CRON_SECRET` and one of `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`.
- **Read by the worker:** `DATABASE_POOL_MIN`, `DATABASE_POOL_MAX`, `DATABASE_SSL`,
  `DATABASE_SSL_ROOT_CERT`, `LOG_LEVEL`, `DEFAULT_TIMEZONE`, `NODE_ENV`.
- **Worker-only, all optional with defaults** (`src/config.ts`): `WORKER_QUEUE_PREFIX`,
  `WORKER_CONCURRENCY`, `WORKER_HEALTH_PORT` (0 disables the health listener),
  `WORKER_SHUTDOWN_TIMEOUT_MS`, `WORKER_ANALYTICS_LOOKBACK_DAYS`, `WORKER_PARTITION_MONTHS_AHEAD`,
  `WORKER_ANALYTICS_RETENTION_MONTHS`, `WORKER_PARTITION_DROP_ENABLED` (default off; dropping a
  partition is irreversible), `WORKER_MAX_PARTITION_DROPS_PER_RUN`,
  `WORKER_SESSION_PURGE_GRACE_DAYS`, `WORKER_DOMAIN_POLL_BATCH`.

The cron path in `apps/web` also reads `WORKER_PARTITION_MONTHS_AHEAD` and
`WORKER_SESSION_PURGE_GRACE_DAYS`. See
[docs/operations/environment.md](../../docs/operations/environment.md) for all variables.

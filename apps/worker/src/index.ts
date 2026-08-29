import { createDatabase } from '@ai-review/db';
import { loadWorkerConfig } from './config';
import { HealthState, startHealthServer } from './health';
import { createLogger } from './logger';
import { ShutdownCoordinator } from './shutdown';
import { BullMqRuntime } from './queue/bullmq';
import { SCHEDULES } from './queue/names';
import { reconcileSchedules } from './queue/scheduler';
import type { JobHandler } from './jobs/types';
import { DailyAnalyticsAggregationJob } from './jobs/analytics/aggregate';
import { PostgresAnalyticsAggregationStore } from './jobs/analytics/store';
import { PartitionMaintenanceJob } from './jobs/partitions/maintain';
import { PostgresPartitionStore } from './jobs/partitions/store';
import { SessionPurgeJob } from './jobs/sessions/purge';
import { CustomDomainPollJob } from './jobs/domains/poll';
import { PostgresCustomDomainStore } from './jobs/domains/store';
import { UnconfiguredCustomDomainProvider } from './jobs/domains/provider';

/**
 * Worker entrypoint — the third of the three services in 02_System_Architecture.md.
 *
 * Composition root: everything is constructed here and injected downwards, so no job reaches
 * for a database, a clock or an environment variable of its own.
 */
async function main(): Promise<void> {
  const config = loadWorkerConfig();
  const logger = createLogger(config.env.LOG_LEVEL, undefined, {
    environment: config.env.NODE_ENV,
  });

  logger.info('worker starting', {
    queuePrefix: config.worker.WORKER_QUEUE_PREFIX,
    concurrency: config.worker.WORKER_CONCURRENCY,
    schedules: SCHEDULES.length,
  });

  const database = createDatabase({
    connectionString: config.env.DATABASE_URL,
    poolMin: config.env.DATABASE_POOL_MIN,
    poolMax: config.env.DATABASE_POOL_MAX,
    ssl: config.env.DATABASE_SSL,
    sslRootCert: config.env.DATABASE_SSL_ROOT_CERT,
  });

  const health = new HealthState();
  const shutdown = new ShutdownCoordinator(logger, config.worker.WORKER_SHUTDOWN_TIMEOUT_MS);

  const handlers: JobHandler[] = [
    new DailyAnalyticsAggregationJob(new PostgresAnalyticsAggregationStore(database), {
      lookbackDays: config.worker.WORKER_ANALYTICS_LOOKBACK_DAYS,
      defaultTimeZone: config.env.DEFAULT_TIMEZONE,
    }),
    new PartitionMaintenanceJob(new PostgresPartitionStore(database), {
      monthsAhead: config.worker.WORKER_PARTITION_MONTHS_AHEAD,
      retentionMonths: config.worker.WORKER_ANALYTICS_RETENTION_MONTHS,
      dropEnabled: config.worker.WORKER_PARTITION_DROP_ENABLED,
      maxDropsPerRun: config.worker.WORKER_MAX_PARTITION_DROPS_PER_RUN,
    }),
    SessionPurgeJob.fromDatabase(database, {
      graceDays: config.worker.WORKER_SESSION_PURGE_GRACE_DAYS,
    }),
    new CustomDomainPollJob(
      new PostgresCustomDomainStore(database),
      // E11 replaces this with the Cloudflare for SaaS adapter. Until then every check fails
      // fast and is logged as a failed check, which is the honest state (see provider.ts).
      new UnconfiguredCustomDomainProvider(),
      { batchSize: config.worker.WORKER_DOMAIN_POLL_BATCH },
    ),
  ];

  const runtime = new BullMqRuntime({
    redisUrl: config.env.REDIS_URL,
    prefix: config.worker.WORKER_QUEUE_PREFIX,
    concurrency: config.worker.WORKER_CONCURRENCY,
    logger,
    health,
    signal: shutdown.signal,
    handlers,
  });

  const healthServer = startHealthServer(config.worker.WORKER_HEALTH_PORT, health, logger);

  // Registration order is drain order: stop taking work, let it finish, then close what it
  // was using. Reversing any two of these truncates a job mid-transaction.
  shutdown.register({
    name: 'health:draining',
    run: () => {
      health.beginDraining();
      return Promise.resolve();
    },
  });
  shutdown.register({ name: 'queue:stop-accepting', run: () => runtime.stopAcceptingWork() });
  shutdown.register({ name: 'queue:close', run: () => runtime.closeConnections() });
  shutdown.register({
    name: 'health:close',
    run: () => healthServer?.close() ?? Promise.resolve(),
  });
  shutdown.register({ name: 'database:close', run: () => database.$client.end() });

  shutdown.listen((code) => {
    process.exit(code);
  });

  const reconciled = await reconcileSchedules(runtime, SCHEDULES, logger);
  logger.info('worker ready', {
    schedules: reconciled.upserted.length,
    stalePruned: reconciled.removed.length,
    handlers: handlers.length,
  });
}

main().catch((error: unknown) => {
  // Boot failure. There is no logger guaranteed to exist at this point, and a worker that
  // cannot start must exit non-zero so the platform stops the rollout rather than running a
  // container that silently processes nothing.
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(
    `${JSON.stringify({ level: 'error', msg: 'worker failed to start', error: message })}\n`,
  );
  process.exit(1);
});

import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { analyticsEvents, businesses, maintenanceJobs, type Database } from '@ai-review/db';
import type { Executor } from '@ai-review/core';
import {
  addDays,
  dayWindow,
  formatLocalDate,
  localDateOf,
  monthsToEnsure,
  resolveTimeZone,
  toMetricRows,
  DEFAULT_PARTITION_NAME,
  PostgresAnalyticsAggregationStore,
  PostgresPartitionStore,
} from '@ai-review/worker/maintenance';
import type { HousekeepingSummary, MaintenanceStore } from './maintenance';

const ANALYTICS_JOB = 'analytics-rollup';
const HOUSEKEEPING_JOB = 'daily-housekeeping';
const SESSION_BATCH = 1_000;
const cursorSchema = z.object({
  cycleAt: z.iso.datetime().nullable(),
  lastCycleAt: z.iso.datetime().nullable(),
  afterBusinessId: z.uuid().nullable(),
  currentBusinessId: z.uuid().nullable(),
  nextDate: z.iso.date().nullable(),
});
type Cursor = z.infer<typeof cursorSchema>;

/** Reuse the worker's existing retention defaults; no partition deletion is enabled here. */
export const maintenanceOptionsSchema = z.object({
  WORKER_PARTITION_MONTHS_AHEAD: z.coerce.number().int().min(1).max(12).default(3),
  WORKER_SESSION_PURGE_GRACE_DAYS: z.coerce.number().int().min(0).max(365).default(7),
});

export class PostgresMaintenanceStore implements MaintenanceStore {
  constructor(
    private readonly database: Database,
    private readonly options = maintenanceOptionsSchema.parse(process.env),
  ) {}

  /** Transaction-level locks work with Neon transaction pooling and release on failure. */
  private async locked<T>(job: string, work: (tx: Executor) => Promise<T>): Promise<T | 'busy'> {
    return this.database.transaction(async (tx) => {
      await tx.execute(sql`set local statement_timeout = '1s'`);
      await tx.execute(sql`set local lock_timeout = '500ms'`);
      await tx.execute(sql`set local idle_in_transaction_session_timeout = '10s'`);
      const lock = await tx.execute<{ acquired: boolean }>(
        sql`select pg_try_advisory_xact_lock(hashtext(${`ai-review:maintenance:${job}`})) as acquired`,
      );
      if (!lock.rows[0]?.acquired) return 'busy';
      return work(tx);
    });
  }

  async housekeeping(now: Date): Promise<HousekeepingSummary | 'busy'> {
    return this.locked(HOUSEKEEPING_JOB, async (tx) => {
      // UTC is required by the partition function's date -> timestamptz conversion.
      await tx.execute(sql`set local timezone = 'UTC'`);
      const partitions = new PostgresPartitionStore(tx);
      const months = monthsToEnsure(now, this.options.WORKER_PARTITION_MONTHS_AHEAD);
      for (const month of months) await partitions.ensurePartition(month);
      const defaultRows = await partitions.countRows(DEFAULT_PARTITION_NAME);

      const cutoff = new Date(
        now.getTime() - this.options.WORKER_SESSION_PURGE_GRACE_DAYS * 86_400_000,
      );
      // Only already-expired sessions, after the existing grace period. No user/account data.
      const deleted = await tx.execute<{ id: string }>(sql`
        delete from sessions where id in (
          select id from sessions where expires_at < ${cutoff}
          order by expires_at, id limit ${SESSION_BATCH}
          for update skip locked
        ) returning id
      `);
      const pending = await tx.execute<{ pending: boolean }>(
        sql`select exists(select 1 from sessions where expires_at < ${cutoff}) as pending`,
      );
      const summary: HousekeepingSummary = {
        partitions_ensured: months.length,
        default_partition_rows: defaultRows,
        sessions_purged: deleted.rows.length,
        session_cleanup_pending: pending.rows[0]?.pending ?? false,
      };
      await tx
        .insert(maintenanceJobs)
        .values({
          name: HOUSEKEEPING_JOB,
          state: summary,
          lastStartedAt: now,
          lastCompletedAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: maintenanceJobs.name,
          set: {
            state: summary,
            lastStartedAt: now,
            lastCompletedAt: now,
            updatedAt: now,
          },
        });
      return summary;
    });
  }

  async analyticsUnit(now: Date): Promise<'day' | 'business' | 'complete' | 'busy'> {
    return this.locked(ANALYTICS_JOB, async (tx) => {
      const [saved] = await tx
        .select()
        .from(maintenanceJobs)
        .where(eq(maintenanceJobs.name, ANALYTICS_JOB))
        .limit(1);
      const cursor: Cursor = saved
        ? cursorSchema.parse(saved.state)
        : {
            cycleAt: null,
            lastCycleAt: null,
            afterBusinessId: null,
            currentBusinessId: null,
            nextDate: null,
          };
      cursor.cycleAt ??= now.toISOString();
      const cycleAt = new Date(cursor.cycleAt);
      const [target] = await tx
        .select({ id: businesses.id, timeZone: businesses.timezone })
        .from(businesses)
        .where(
          and(
            isNull(businesses.deletedAt),
            cursor.currentBusinessId
              ? eq(businesses.id, cursor.currentBusinessId)
              : cursor.afterBusinessId
                ? gt(businesses.id, cursor.afterBusinessId)
                : undefined,
          ),
        )
        .orderBy(businesses.id)
        .limit(1);

      if (!target) {
        // A tenant deleted during a cycle must not stop the remaining tenants progressing.
        if (cursor.currentBusinessId) {
          cursor.afterBusinessId = cursor.currentBusinessId;
          cursor.currentBusinessId = null;
          cursor.nextDate = null;
          await this.saveCursor(tx, cursor, now);
          return 'business';
        }
        cursor.lastCycleAt = cursor.cycleAt;
        cursor.cycleAt = null;
        cursor.afterBusinessId = null;
        await this.saveCursor(tx, cursor, now, true);
        return 'complete';
      }

      const zone = resolveTimeZone(target.timeZone);
      const endDate = formatLocalDate(localDateOf(cycleAt, zone));
      if (!cursor.nextDate) {
        const [first] = await tx
          .select({ occurredAt: analyticsEvents.occurredAt })
          .from(analyticsEvents)
          .where(eq(analyticsEvents.businessId, target.id))
          .orderBy(analyticsEvents.occurredAt)
          .limit(1);
        if (first) {
          const earliest = formatLocalDate(localDateOf(first.occurredAt, zone));
          // First run catches up all existing history; later cycles catch missed days and
          // recompute two completed days for late events, matching the original worker.
          const lookback = cursor.lastCycleAt
            ? formatLocalDate(addDays(localDateOf(new Date(cursor.lastCycleAt), zone), -2))
            : earliest;
          cursor.nextDate = earliest > lookback ? earliest : lookback;
        }
      }

      if (!cursor.nextDate || cursor.nextDate >= endDate) {
        cursor.afterBusinessId = target.id;
        cursor.currentBusinessId = null;
        cursor.nextDate = null;
        await this.saveCursor(tx, cursor, now);
        return 'business';
      }

      const date = new Date(`${cursor.nextDate}T00:00:00.000Z`);
      const local = {
        year: date.getUTCFullYear(),
        month: date.getUTCMonth() + 1,
        day: date.getUTCDate(),
      };
      const window = dayWindow(local, zone);
      const aggregation = new PostgresAnalyticsAggregationStore(tx);
      const tallies = await aggregation.tally(target.id, window.startUtc, window.endUtc);
      const metrics = toMetricRows(tallies.tallies, tallies.uniqueSessions);
      await aggregation.replaceDaily(target.id, window.metricDate, metrics.rows);
      cursor.currentBusinessId = target.id;
      cursor.nextDate = formatLocalDate(addDays(local, 1));
      // Rollup and cursor commit together: a retry cannot skip a day or double count it.
      await this.saveCursor(tx, cursor, now);
      return 'day';
    });
  }

  private async saveCursor(
    tx: Executor,
    cursor: Cursor,
    now: Date,
    complete = false,
  ): Promise<void> {
    const values = {
      state: cursor,
      lastStartedAt: cursor.cycleAt ? new Date(cursor.cycleAt) : now,
      updatedAt: now,
      ...(complete ? { lastCompletedAt: now } : {}),
    };
    await tx
      .insert(maintenanceJobs)
      .values({ name: ANALYTICS_JOB, ...values })
      .onConflictDoUpdate({ target: maintenanceJobs.name, set: values });
  }
}

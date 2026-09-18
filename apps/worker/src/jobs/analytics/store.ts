import { and, eq, gt, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import { analyticsDailyBusiness, analyticsEvents, businesses } from '@ai-review/db';
import type { Executor } from '@ai-review/core';
import { AGGREGATED_METRIC_NAMES, type DailyMetricRow, type EventTally } from './metrics';

/**
 * Storage contract for the daily rollup.
 *
 * Split port/implementation on the same principle as MemoryQuotaStore / PostgresQuotaStore in
 * packages/core: the interesting logic (which local day, which metrics, does a re-run
 * overwrite) is then testable without Postgres, and the SQL is small enough to read.
 */

export interface AggregationTarget {
  businessId: string;
  /** Raw businesses.timezone; may be invalid, so callers pass it through resolveTimeZone. */
  timeZone: string;
}

export interface DailyEventTallies {
  tallies: EventTally[];
  /** Distinct anonymous sessions across the whole window, not the sum of the per-event ones. */
  uniqueSessions: number;
}

export interface AnalyticsAggregationStore {
  /** Keyset pagination by business id; `afterId` is null for the first page. */
  listBusinesses(afterId: string | null, limit: number): Promise<AggregationTarget[]>;
  tally(businessId: string, startUtc: Date, endUtc: Date): Promise<DailyEventTallies>;
  /**
   * Replaces this job's metrics for one (business, date). MUST be atomic and MUST delete
   * before inserting — see the note on the Postgres implementation.
   */
  replaceDaily(
    businessId: string,
    metricDate: string,
    rows: readonly DailyMetricRow[],
  ): Promise<void>;
}

export class PostgresAnalyticsAggregationStore implements AnalyticsAggregationStore {
  constructor(private readonly db: Executor) {}

  /**
   * Soft-deleted tenants are skipped; suspended ones are not. A suspended business keeps its
   * history and gets it back on reactivation (Flow J), so excluding it here would leave a hole
   * in the dashboard that no later run ever fills.
   */
  async listBusinesses(afterId: string | null, limit: number): Promise<AggregationTarget[]> {
    const rows = await this.db
      .select({ businessId: businesses.id, timeZone: businesses.timezone })
      .from(businesses)
      .where(and(isNull(businesses.deletedAt), afterId ? gt(businesses.id, afterId) : undefined))
      .orderBy(businesses.id)
      .limit(limit);

    return rows;
  }

  async tally(businessId: string, startUtc: Date, endUtc: Date): Promise<DailyEventTallies> {
    const window = and(
      eq(analyticsEvents.businessId, businessId),
      gte(analyticsEvents.occurredAt, startUtc),
      lt(analyticsEvents.occurredAt, endUtc),
    );

    // ::int rather than the default bigint-as-text, so the driver hands back numbers. One
    // business-day cannot approach 2^31 events; the platform total at modelled scale is ~300M
    // rows across 13 months.
    const tallies = await this.db
      .select({
        eventName: analyticsEvents.eventName,
        eventCount: sql<number>`count(*)::int`,
        uniqueSessions: sql<number>`count(distinct ${analyticsEvents.anonymousSessionId})::int`,
      })
      .from(analyticsEvents)
      .where(window)
      .groupBy(analyticsEvents.eventName);

    // A second pass over the same index range rather than GROUPING SETS: distinct sessions
    // across all events is not derivable from the per-event distincts, and the range is one
    // business-day, so the extra scan is cheap and the query stays readable.
    const [totals] = await this.db
      .select({
        uniqueSessions: sql<number>`count(distinct ${analyticsEvents.anonymousSessionId})::int`,
      })
      .from(analyticsEvents)
      .where(window);

    return { tallies, uniqueSessions: totals?.uniqueSessions ?? 0 };
  }

  /**
   * Idempotency, which is the requirement most easily got wrong here.
   *
   * Delete-then-insert inside one transaction, NOT an upsert. An upsert leaves behind rows
   * from a previous run whose dimension no longer appears — correcting or backfilling events
   * would leave a stale `event_count` for an event the day no longer contains, and it would
   * never be noticed because the row looks exactly like a real one. The delete is scoped to
   * AGGREGATED_METRIC_NAMES so it only ever removes rows this job wrote.
   */
  async replaceDaily(
    businessId: string,
    metricDate: string,
    rows: readonly DailyMetricRow[],
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .delete(analyticsDailyBusiness)
        .where(
          and(
            eq(analyticsDailyBusiness.businessId, businessId),
            eq(analyticsDailyBusiness.metricDate, metricDate),
            inArray(analyticsDailyBusiness.metricName, [...AGGREGATED_METRIC_NAMES]),
          ),
        );

      if (rows.length === 0) return;

      await tx.insert(analyticsDailyBusiness).values(
        rows.map((row) => ({
          businessId,
          metricDate,
          metricName: row.metricName,
          dimensionKey: row.dimensionKey,
          metricValue: row.metricValue,
          updatedAt: new Date(),
        })),
      );
    });
  }
}

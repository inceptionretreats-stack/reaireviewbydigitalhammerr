import { AGGREGATED_METRIC_NAMES, type DailyMetricRow, type EventTally } from './metrics';
import type { AggregationTarget, AnalyticsAggregationStore, DailyEventTallies } from './store';

/**
 * In-memory store holding raw events, not pre-computed tallies.
 *
 * Keeping the raw stream means the tests exercise the bucketing decision itself — an event at
 * 19:00Z really does have to land on the next Asia/Kolkata day — rather than asserting against
 * numbers the test fixture already decided. Mirrors MemoryQuotaStore in packages/core.
 */

export interface MemoryAnalyticsEvent {
  businessId: string;
  eventName: string;
  /** Null models an event with no anonymous session, which distinct counting must ignore. */
  anonymousSessionId: string | null;
  occurredAt: Date;
}

export interface StoredDailyRow extends DailyMetricRow {
  businessId: string;
  metricDate: string;
}

export class MemoryAnalyticsAggregationStore implements AnalyticsAggregationStore {
  private readonly targets: AggregationTarget[] = [];
  private readonly events: MemoryAnalyticsEvent[] = [];
  private daily: StoredDailyRow[] = [];

  addBusiness(target: AggregationTarget): void {
    this.targets.push(target);
    this.targets.sort((a, b) => a.businessId.localeCompare(b.businessId));
  }

  addEvent(event: MemoryAnalyticsEvent): void {
    this.events.push(event);
  }

  /** Seeds a row as if written by an earlier run, to prove a re-run replaces it. */
  seedDailyRow(row: StoredDailyRow): void {
    this.daily.push(row);
  }

  rowsFor(businessId: string, metricDate: string): StoredDailyRow[] {
    return this.daily
      .filter((row) => row.businessId === businessId && row.metricDate === metricDate)
      .sort(
        (a, b) =>
          a.metricName.localeCompare(b.metricName) || a.dimensionKey.localeCompare(b.dimensionKey),
      );
  }

  get allRows(): readonly StoredDailyRow[] {
    return this.daily;
  }

  listBusinesses(afterId: string | null, limit: number): Promise<AggregationTarget[]> {
    const page = this.targets
      .filter((target) => afterId === null || target.businessId > afterId)
      .slice(0, limit);
    return Promise.resolve(page);
  }

  tally(businessId: string, startUtc: Date, endUtc: Date): Promise<DailyEventTallies> {
    const inWindow = this.events.filter(
      (event) =>
        event.businessId === businessId &&
        event.occurredAt.getTime() >= startUtc.getTime() &&
        event.occurredAt.getTime() < endUtc.getTime(),
    );

    const byName = new Map<string, { count: number; sessions: Set<string> }>();
    const allSessions = new Set<string>();

    for (const event of inWindow) {
      const entry = byName.get(event.eventName) ?? { count: 0, sessions: new Set<string>() };
      entry.count += 1;
      if (event.anonymousSessionId !== null) {
        entry.sessions.add(event.anonymousSessionId);
        allSessions.add(event.anonymousSessionId);
      }
      byName.set(event.eventName, entry);
    }

    const tallies: EventTally[] = [...byName.entries()].map(([eventName, entry]) => ({
      eventName,
      eventCount: entry.count,
      uniqueSessions: entry.sessions.size,
    }));

    return Promise.resolve({ tallies, uniqueSessions: allSessions.size });
  }

  replaceDaily(
    businessId: string,
    metricDate: string,
    rows: readonly DailyMetricRow[],
  ): Promise<void> {
    const owned = new Set<string>(AGGREGATED_METRIC_NAMES);

    this.daily = this.daily.filter(
      (row) =>
        !(
          row.businessId === businessId &&
          row.metricDate === metricDate &&
          owned.has(row.metricName)
        ),
    );

    for (const row of rows) {
      this.daily.push({ ...row, businessId, metricDate });
    }

    return Promise.resolve();
  }
}

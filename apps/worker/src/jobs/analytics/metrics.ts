import { FUNNEL_EVENTS, isEventName } from '@ai-review/analytics';

/**
 * Shape of the daily rollup (AN-01-01, ADR-005).
 *
 * `analytics_daily_business` is keyed (business_id, metric_date, metric_name, dimension_key),
 * so metric names stay few and the event name goes in the dimension. Two metrics cover the
 * dashboard:
 *
 *   event_count      / dimension = event name  — raw volume per event.
 *   unique_sessions  / dimension = event name  — distinct anonymous sessions reaching a funnel
 *                                                step, which is what a funnel chart plots.
 *   unique_sessions  / dimension = ''          — distinct sessions for the day overall.
 *
 * Compliance boundary. The funnel's last step is `google_open` and there is nothing after it,
 * because D-028 and AC-025 mean the platform observes only that Google was opened. No metric
 * defined here may be presented, named or derived in a way that implies more than that; the
 * event catalogue in packages/analytics deliberately offers no event that would allow it.
 *
 * D-009 has a consequence here too: no star rating is ever collected before Google, so no
 * rating dimension exists to aggregate.
 */

export const METRIC_EVENT_COUNT = 'event_count';
export const METRIC_UNIQUE_SESSIONS = 'unique_sessions';

/**
 * Metric names this job owns. Idempotent re-runs delete by this list rather than by
 * (business, date) alone, so a future producer writing other metrics into the same table is
 * not silently erased by a rollup.
 */
export const AGGREGATED_METRIC_NAMES = [METRIC_EVENT_COUNT, METRIC_UNIQUE_SESSIONS] as const;

/** The dimension for a whole-day total, matching the column default. */
export const TOTAL_DIMENSION = '';

export interface EventTally {
  eventName: string;
  eventCount: number;
  uniqueSessions: number;
}

export interface DailyMetricRow {
  metricName: string;
  dimensionKey: string;
  metricValue: number;
}

export interface MetricRowsResult {
  rows: DailyMetricRow[];
  /** Event names not in 11_Analytics_Event_Taxonomy.csv. Reported so drift is visible. */
  ignoredEventNames: string[];
}

const FUNNEL = new Set<string>(FUNNEL_EVENTS);

/**
 * Turns one day's tallies into rows.
 *
 * Zero-valued rows are omitted rather than stored: the column defaults to 0 and a dashboard
 * must already treat a missing (date, metric) pair as zero, so writing explicit zeros for
 * twenty-three events a small business never fires multiplies the table by an order of
 * magnitude for no information.
 */
export function toMetricRows(
  tallies: readonly EventTally[],
  totalUniqueSessions: number,
): MetricRowsResult {
  const rows: DailyMetricRow[] = [];
  const ignoredEventNames: string[] = [];

  for (const tally of tallies) {
    if (!isEventName(tally.eventName)) {
      // Ingestion validates against the taxonomy, so this means either a server-side writer
      // drifted or the taxonomy shrank. Either way, aggregating it would invent a metric.
      ignoredEventNames.push(tally.eventName);
      continue;
    }

    if (tally.eventCount > 0) {
      rows.push({
        metricName: METRIC_EVENT_COUNT,
        dimensionKey: tally.eventName,
        metricValue: tally.eventCount,
      });
    }

    if (FUNNEL.has(tally.eventName) && tally.uniqueSessions > 0) {
      rows.push({
        metricName: METRIC_UNIQUE_SESSIONS,
        dimensionKey: tally.eventName,
        metricValue: tally.uniqueSessions,
      });
    }
  }

  if (totalUniqueSessions > 0) {
    rows.push({
      metricName: METRIC_UNIQUE_SESSIONS,
      dimensionKey: TOTAL_DIMENSION,
      metricValue: totalUniqueSessions,
    });
  }

  // Deterministic order so a diff between two runs is a diff in the data, not in iteration.
  rows.sort(
    (a, b) =>
      a.metricName.localeCompare(b.metricName) || a.dimensionKey.localeCompare(b.dimensionKey),
  );

  return { rows, ignoredEventNames: [...new Set(ignoredEventNames)].sort() };
}

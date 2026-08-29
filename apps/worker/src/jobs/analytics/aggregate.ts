import { JOB_NAMES } from '../../queue/names';
import { JobAbortedError, type JobContext, type JobHandler, type JobSummary } from '../types';
import { completedDaysBefore, DEFAULT_TIME_ZONE, resolveTimeZone } from './date-bucket';
import { toMetricRows } from './metrics';
import type { AnalyticsAggregationStore } from './store';

/**
 * Daily analytics aggregation (ADR-005, AN-01, 02_System_Architecture.md "Precomputed daily
 * aggregates for dashboard charts").
 *
 * Per business, per completed business-local day: tally the raw events in that day's absolute
 * window and replace the rollup rows for it. Both halves matter —
 *
 *  - the window comes from the tenant's own timezone, which is what AC-026 requires and what
 *    AMENDMENT-004 added the column for;
 *  - replacement rather than accumulation is what makes a re-run safe, and a re-run happens
 *    every night by design because `lookbackDays` is greater than one.
 */

export interface DailyAggregationOptions {
  /** Completed local days recomputed each run, newest last. */
  lookbackDays: number;
  /** Businesses fetched per keyset page. */
  batchSize?: number;
  defaultTimeZone?: string;
}

export class DailyAnalyticsAggregationJob implements JobHandler {
  readonly name = JOB_NAMES.analyticsDailyRollup;

  constructor(
    private readonly store: AnalyticsAggregationStore,
    private readonly options: DailyAggregationOptions,
  ) {}

  async run(context: JobContext): Promise<JobSummary> {
    const batchSize = this.options.batchSize ?? 200;
    const fallbackZone = this.options.defaultTimeZone ?? DEFAULT_TIME_ZONE;

    let cursor: string | null = null;
    let businesses = 0;
    let daysWritten = 0;
    let rowsWritten = 0;
    let substitutedTimeZones = 0;
    const failures: string[] = [];

    for (;;) {
      const page = await this.store.listBusinesses(cursor, batchSize);
      if (page.length === 0) break;

      for (const target of page) {
        // Checked per business rather than per page: a page of 200 tenants can outlast the
        // SIGTERM grace period on its own.
        if (context.signal.aborted) throw new JobAbortedError(this.name);

        const timeZone = resolveTimeZone(target.timeZone, fallbackZone);
        if (timeZone !== target.timeZone) {
          substitutedTimeZones += 1;
          context.logger.warn('business timezone not recognised, using documented default', {
            businessId: target.businessId,
            configured: target.timeZone,
            using: timeZone,
          });
        }

        try {
          const result = await this.rollUpBusiness(context, target.businessId, timeZone);
          daysWritten += result.days;
          rowsWritten += result.rows;
        } catch (error) {
          if (error instanceof JobAbortedError) throw error;
          failures.push(target.businessId);
          context.logger.error('daily rollup failed for business', error, {
            businessId: target.businessId,
            timeZone,
          });
        }

        businesses += 1;
      }

      const last = page[page.length - 1];
      if (!last || page.length < batchSize) break;
      cursor = last.businessId;
    }

    // Fail the job so BullMQ retries. Safe precisely because the work is idempotent: a retry
    // recomputes the tenants that already succeeded to the same values, and the runbook's
    // "queue retry exhaustion" alert is how a persistently broken tenant surfaces. Silently
    // returning success here would make a partial rollup indistinguishable from a good one.
    if (failures.length > 0) {
      throw new Error(
        `Daily rollup failed for ${failures.length} of ${businesses} businesses ` +
          `(first: ${failures[0] ?? 'unknown'})`,
      );
    }

    return {
      businesses,
      daysWritten,
      rowsWritten,
      substitutedTimeZones,
      lookbackDays: this.options.lookbackDays,
    };
  }

  private async rollUpBusiness(
    context: JobContext,
    businessId: string,
    timeZone: string,
  ): Promise<{ days: number; rows: number }> {
    const windows = completedDaysBefore(context.now, timeZone, this.options.lookbackDays);
    let rows = 0;

    for (const window of windows) {
      if (context.signal.aborted) throw new JobAbortedError(this.name);

      const { tallies, uniqueSessions } = await this.store.tally(
        businessId,
        window.startUtc,
        window.endUtc,
      );
      const metrics = toMetricRows(tallies, uniqueSessions);

      if (metrics.ignoredEventNames.length > 0) {
        context.logger.warn('event names outside the taxonomy were not aggregated', {
          businessId,
          metricDate: window.metricDate,
          eventNames: metrics.ignoredEventNames.join(','),
        });
      }

      // Called even when there are no rows: that is how a day whose events were deleted or
      // corrected loses its stale aggregate.
      await this.store.replaceDaily(businessId, window.metricDate, metrics.rows);
      rows += metrics.rows.length;
    }

    return { days: windows.length, rows };
  }
}

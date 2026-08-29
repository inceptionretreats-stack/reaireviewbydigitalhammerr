import { describe, expect, it } from 'vitest';
import { DailyAnalyticsAggregationJob } from '../jobs/analytics/aggregate';
import { MemoryAnalyticsAggregationStore } from '../jobs/analytics/memory-store';
import type { DailyEventTallies } from '../jobs/analytics/store';
import { JobAbortedError } from '../jobs/types';
import { harness } from './support/harness';

/**
 * The daily rollup, exercised end to end against raw events rather than pre-computed tallies,
 * so the bucketing decision itself is under test rather than a fixture's opinion of it.
 *
 * NOW is 07:30 on 30 August in Kolkata and 19:00 on 29 August in Los Angeles, so with a
 * one-day lookback the two tenants roll up different calendar days from the same event stream.
 */
const NOW = '2026-08-30T02:00:00.000Z';

const KOLKATA_BIZ = 'biz-kolkata';
const LA_BIZ = 'biz-la';
const BAD_TZ_BIZ = 'biz-bad-timezone';

function seededStore(): MemoryAnalyticsAggregationStore {
  const store = new MemoryAnalyticsAggregationStore();

  store.addBusiness({ businessId: KOLKATA_BIZ, timeZone: 'Asia/Kolkata' });
  store.addBusiness({ businessId: LA_BIZ, timeZone: 'America/Los_Angeles' });
  store.addBusiness({ businessId: BAD_TZ_BIZ, timeZone: 'Mars/Olympus_Mons' });

  const event = (
    businessId: string,
    eventName: string,
    anonymousSessionId: string | null,
    occurredAt: string,
  ) => {
    store.addEvent({ businessId, eventName, anonymousSessionId, occurredAt: new Date(occurredAt) });
  };

  // 00:30 on the 29th in Kolkata, but the 28th in UTC. This is the AC-026 case.
  event(KOLKATA_BIZ, 'google_open', 'session-1', '2026-08-28T19:00:00.000Z');
  event(KOLKATA_BIZ, 'review_page_view', 'session-1', '2026-08-29T05:00:00.000Z');
  event(KOLKATA_BIZ, 'review_page_view', 'session-2', '2026-08-29T05:05:00.000Z');
  event(KOLKATA_BIZ, 'profile_view', 'session-1', '2026-08-29T06:00:00.000Z');
  // Outside the taxonomy: must be ignored rather than aggregated into an invented metric.
  event(KOLKATA_BIZ, 'legacy_thing', 'session-1', '2026-08-29T06:30:00.000Z');
  // 00:15 on the 30th locally: the current local day, which is not complete yet.
  event(KOLKATA_BIZ, 'google_open', 'session-3', '2026-08-29T18:45:00.000Z');
  // 22:30 on the 28th locally: outside a one-day lookback.
  event(KOLKATA_BIZ, 'qr_scan', 'session-9', '2026-08-28T17:00:00.000Z');

  // Same instant as the first Kolkata event: noon on the 28th in Los Angeles.
  event(LA_BIZ, 'google_open', 'session-1', '2026-08-28T19:00:00.000Z');
  event(BAD_TZ_BIZ, 'google_open', 'session-1', '2026-08-28T19:00:00.000Z');

  return store;
}

function job(store: MemoryAnalyticsAggregationStore): DailyAnalyticsAggregationJob {
  return new DailyAnalyticsAggregationJob(store, { lookbackDays: 1 });
}

describe('daily analytics aggregation', () => {
  it('buckets events by the business-local day, not the UTC day', async () => {
    const store = seededStore();
    await job(store).run(harness(NOW).context);

    expect(store.rowsFor(KOLKATA_BIZ, '2026-08-29')).toEqual([
      {
        businessId: KOLKATA_BIZ,
        metricDate: '2026-08-29',
        metricName: 'event_count',
        dimensionKey: 'google_open',
        metricValue: 1,
      },
      {
        businessId: KOLKATA_BIZ,
        metricDate: '2026-08-29',
        metricName: 'event_count',
        dimensionKey: 'profile_view',
        metricValue: 1,
      },
      {
        businessId: KOLKATA_BIZ,
        metricDate: '2026-08-29',
        metricName: 'event_count',
        dimensionKey: 'review_page_view',
        metricValue: 2,
      },
      {
        businessId: KOLKATA_BIZ,
        metricDate: '2026-08-29',
        metricName: 'unique_sessions',
        dimensionKey: '',
        metricValue: 2,
      },
      {
        businessId: KOLKATA_BIZ,
        metricDate: '2026-08-29',
        metricName: 'unique_sessions',
        dimensionKey: 'google_open',
        metricValue: 1,
      },
      {
        businessId: KOLKATA_BIZ,
        metricDate: '2026-08-29',
        metricName: 'unique_sessions',
        dimensionKey: 'review_page_view',
        metricValue: 2,
      },
    ]);

    // A UTC boundary would have put the 19:00Z google_open on the 28th.
    expect(store.rowsFor(KOLKATA_BIZ, '2026-08-28')).toEqual([]);
  });

  it('assigns one instant to different dates for tenants in different timezones', async () => {
    const store = seededStore();
    await job(store).run(harness(NOW).context);

    const kolkata = store.rowsFor(KOLKATA_BIZ, '2026-08-29');
    const losAngeles = store.rowsFor(LA_BIZ, '2026-08-28');

    expect(kolkata.some((row) => row.dimensionKey === 'google_open')).toBe(true);
    expect(losAngeles.map((row) => [row.metricName, row.dimensionKey, row.metricValue])).toEqual([
      ['event_count', 'google_open', 1],
      ['unique_sessions', '', 1],
      ['unique_sessions', 'google_open', 1],
    ]);
    expect(store.rowsFor(LA_BIZ, '2026-08-29')).toEqual([]);
  });

  it('counts distinct sessions rather than events', async () => {
    const store = seededStore();
    await job(store).run(harness(NOW).context);

    const rows = store.rowsFor(KOLKATA_BIZ, '2026-08-29');
    const totalEvents = rows
      .filter((row) => row.metricName === 'event_count')
      .reduce((sum, row) => sum + row.metricValue, 0);
    const uniqueSessions = rows.find(
      (row) => row.metricName === 'unique_sessions' && row.dimensionKey === '',
    );

    expect(totalEvents).toBe(4);
    expect(uniqueSessions?.metricValue).toBe(2);
  });

  it('records unique sessions only for funnel events', async () => {
    const store = seededStore();
    await job(store).run(harness(NOW).context);

    const rows = store.rowsFor(KOLKATA_BIZ, '2026-08-29');
    // profile_view is not a funnel step, so it gets volume but no session metric.
    expect(
      rows.some((r) => r.metricName === 'event_count' && r.dimensionKey === 'profile_view'),
    ).toBe(true);
    expect(
      rows.some((r) => r.metricName === 'unique_sessions' && r.dimensionKey === 'profile_view'),
    ).toBe(false);
  });

  it('ignores event names outside the taxonomy and says so', async () => {
    const store = seededStore();
    const test = harness(NOW);
    await job(store).run(test.context);

    expect(store.allRows.some((row) => row.dimensionKey === 'legacy_thing')).toBe(false);
    expect(test.sink.messages('warn')).toContain(
      'event names outside the taxonomy were not aggregated',
    );
  });
});

describe('idempotency', () => {
  /** The rollup re-runs the same day every night by design; it must overwrite, not accumulate. */
  it('produces identical rows when run twice', async () => {
    const store = seededStore();

    await job(store).run(harness(NOW).context);
    const first = store.rowsFor(KOLKATA_BIZ, '2026-08-29');
    const firstTotal = store.allRows.length;

    await job(store).run(harness(NOW).context);
    const second = store.rowsFor(KOLKATA_BIZ, '2026-08-29');

    expect(second).toEqual(first);
    expect(store.allRows.length).toBe(firstTotal);
    expect(second.find((row) => row.dimensionKey === 'review_page_view')?.metricValue).toBe(2);
  });

  /**
   * Why delete-then-insert rather than an upsert. A dimension that no longer has events must
   * disappear; an upsert would leave the stale row looking exactly like a real one.
   */
  it('removes a row from a previous run whose events no longer exist', async () => {
    const store = seededStore();
    store.seedDailyRow({
      businessId: KOLKATA_BIZ,
      metricDate: '2026-08-29',
      metricName: 'event_count',
      dimensionKey: 'qr_scan',
      metricValue: 99,
    });

    await job(store).run(harness(NOW).context);

    expect(store.rowsFor(KOLKATA_BIZ, '2026-08-29').some((r) => r.dimensionKey === 'qr_scan')).toBe(
      false,
    );
  });

  /** The delete is scoped to the metrics this job owns, so another producer is not erased. */
  it('leaves metrics it does not own untouched', async () => {
    const store = seededStore();
    store.seedDailyRow({
      businessId: KOLKATA_BIZ,
      metricDate: '2026-08-29',
      metricName: 'ai_cost_paise',
      dimensionKey: '',
      metricValue: 4200,
    });

    await job(store).run(harness(NOW).context);

    expect(
      store.rowsFor(KOLKATA_BIZ, '2026-08-29').find((r) => r.metricName === 'ai_cost_paise')
        ?.metricValue,
    ).toBe(4200);
  });
});

describe('resilience', () => {
  it('falls back to the documented default timezone and reports the substitution', async () => {
    const store = seededStore();
    const test = harness(NOW);

    const summary = await job(store).run(test.context);

    // Asia/Kolkata bucketing, so the 19:00Z event lands on the 29th.
    expect(store.rowsFor(BAD_TZ_BIZ, '2026-08-29')).toHaveLength(3);
    expect(summary.substitutedTimeZones).toBe(1);
    expect(test.sink.messages('warn')).toContain(
      'business timezone not recognised, using documented default',
    );
  });

  /**
   * A failure must not be reported as success — a partially written rollup is indistinguishable
   * from a complete one. It throws so BullMQ retries, which is safe because the work is
   * idempotent, and the tenants that did succeed keep their rows.
   */
  it('finishes the other tenants, then fails the job', async () => {
    class FailingStore extends MemoryAnalyticsAggregationStore {
      constructor(private readonly failFor: string) {
        super();
      }

      override tally(businessId: string, startUtc: Date, endUtc: Date): Promise<DailyEventTallies> {
        if (businessId === this.failFor) {
          return Promise.reject(new Error('tally exploded'));
        }
        return super.tally(businessId, startUtc, endUtc);
      }
    }

    const store = new FailingStore(KOLKATA_BIZ);
    store.addBusiness({ businessId: KOLKATA_BIZ, timeZone: 'Asia/Kolkata' });
    store.addBusiness({ businessId: LA_BIZ, timeZone: 'America/Los_Angeles' });
    store.addEvent({
      businessId: LA_BIZ,
      eventName: 'google_open',
      anonymousSessionId: 'session-1',
      occurredAt: new Date('2026-08-28T19:00:00.000Z'),
    });

    const test = harness(NOW);
    await expect(job(store).run(test.context)).rejects.toThrow(/failed for 1 of 2 businesses/);

    expect(store.rowsFor(LA_BIZ, '2026-08-28')).toHaveLength(3);
    expect(test.sink.messages('error')).toContain('daily rollup failed for business');
  });

  it('stops when the worker is shutting down', async () => {
    const store = seededStore();
    const test = harness(NOW, { aborted: true });

    await expect(job(store).run(test.context)).rejects.toBeInstanceOf(JobAbortedError);
    expect(store.allRows).toHaveLength(0);
  });
});

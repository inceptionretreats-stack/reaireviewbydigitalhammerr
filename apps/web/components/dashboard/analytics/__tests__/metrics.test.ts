import { describe, expect, it } from 'vitest';
import { FUNNEL_EVENTS } from '@ai-review/analytics';
import {
  assembleTrend,
  buildFunnel,
  FUNNEL_STEPS,
  funnelStepLabel,
  pendingRollupGap,
  REPORTED_EVENTS,
  toSeries,
  totalOf,
  type RollupRow,
  type TrendDay,
} from '../metrics';
import {
  addDays,
  EVENT_RETENTION_DAYS,
  formatLocalDate,
  resolveAnalyticsRange,
  type AnalyticsRange,
} from '../range';

/**
 * AN-01-01, AN-01-02, AC-025 and DASH-01-02, pinned so a well-meaning copy edit cannot loosen
 * them. The eslint rule in `eslint.config.mjs` already fails the build on the literal forbidden
 * phrase; these tests cover the wider claim — that no label, description or derived metric on
 * this screen presents `google_open` as anything more than an opened page.
 */

const FORBIDDEN_CLAIM = /submit|posted|published|left a review|wrote a review/i;

describe('funnel definition', () => {
  it('is exactly the taxonomy funnel, in order (AN-01-01)', () => {
    // FUNNEL_EVENTS is generated from 11_Analytics_Event_Taxonomy.csv, so this is what makes the
    // screen's metric definitions structurally tied to the event contract rather than to review.
    expect(FUNNEL_STEPS.map((step) => step.event)).toEqual([...FUNNEL_EVENTS]);
    expect(FUNNEL_STEPS).toHaveLength(5);
  });

  it('ends on the Google review page being opened, in the mandated wording', () => {
    const terminal = FUNNEL_STEPS[FUNNEL_STEPS.length - 1];
    expect(terminal?.event).toBe('google_open');
    // The exact phrase 18_UI_UX_Design_System_Brief.md requires.
    expect(terminal?.label).toBe('Google review page opened');
    expect(funnelStepLabel('google_open')).toBe('Google review page opened');
  });

  it('never claims a review was left, posted or completed (AC-025, DASH-01-02)', () => {
    for (const step of FUNNEL_STEPS) {
      expect(step.label).not.toMatch(FORBIDDEN_CLAIM);
      // The terminal description says what the platform cannot see; it must not do so by using
      // the forbidden verb either.
      expect(step.description).not.toMatch(FORBIDDEN_CLAIM);
    }
  });

  it('gives every step a real label and a plain-language description', () => {
    for (const step of FUNNEL_STEPS) {
      expect(step.label.length).toBeGreaterThan(0);
      expect(step.description.length).toBeGreaterThan(0);
    }
  });
});

describe('buildFunnel', () => {
  const typical = buildFunnel({
    qr_scan: 100,
    review_page_view: 80,
    ai_generate_success: 60,
    review_copy: 45,
    google_open: 30,
  });

  it('measures every step against the entry step', () => {
    expect(typical.entrySessions).toBe(100);
    expect(typical.steps.map((step) => step.shareOfEntry)).toEqual([100, 80, 60, 45, 30]);
  });

  it('reports drop-off between consecutive steps, which is the product question', () => {
    expect(typical.steps.map((step) => step.change)).toEqual([
      'entry',
      'dropped',
      'dropped',
      'dropped',
      'dropped',
    ]);
    expect(typical.steps.map((step) => step.changeSessions)).toEqual([0, 20, 20, 15, 15]);
    // 20 of 100, 20 of 80, 15 of 60, 15 of 45.
    expect(typical.steps.map((step) => step.changePercent)).toEqual([null, 20, 25, 25, 33.3]);
  });

  it('names the step that loses the most sessions, earliest wins a tie', () => {
    // Steps 1 and 2 both lose 20; the earlier one is reported, so the answer does not flip when
    // a later step happens to lose the same number.
    expect(typical.largestDropIndex).toBe(1);
  });

  it('reports reaching Google as a share of entry and nothing more', () => {
    expect(typical.reachedGoogleSessions).toBe(30);
    expect(typical.reachedGooglePercent).toBe(30);
  });

  it('records a step that gains sessions instead of clamping it away', () => {
    // Real and common: customers reach the review page from the public profile or a shared link
    // without ever scanning a standee. Clamping would attribute them to a QR code.
    const gained = buildFunnel({ qr_scan: 40, review_page_view: 55, google_open: 10 });

    expect(gained.steps[1]?.change).toBe('gained');
    expect(gained.steps[1]?.changeSessions).toBe(-15);
    expect(gained.steps[1]?.changePercent).toBe(37.5);
    expect(gained.steps[1]?.shareOfEntry).toBe(137.5);
  });

  it('treats a missing event as zero rather than as absent', () => {
    const sparse = buildFunnel({ qr_scan: 10 });
    expect(sparse.steps.map((step) => step.sessions)).toEqual([10, 0, 0, 0, 0]);
    expect(sparse.reachedGoogleSessions).toBe(0);
    expect(sparse.reachedGooglePercent).toBe(0);
  });

  it('is empty rather than flat when nothing happened', () => {
    const nothing = buildFunnel({});

    expect(nothing.isEmpty).toBe(true);
    expect(nothing.entrySessions).toBe(0);
    // Null, not 0%: dividing by an entry step of zero has no answer, and printing 0% would
    // suggest customers arrived and left.
    expect(nothing.steps.every((step) => step.shareOfEntry === null)).toBe(true);
    expect(nothing.reachedGooglePercent).toBeNull();
    expect(nothing.largestDropIndex).toBeNull();
  });

  it('is not empty when only the last step recorded anything', () => {
    const direct = buildFunnel({ google_open: 3 });
    expect(direct.isEmpty).toBe(false);
    expect(direct.steps[4]?.change).toBe('gained');
  });

  it('reports unchanged rather than dropped when a step holds level', () => {
    const level = buildFunnel({ qr_scan: 5, review_page_view: 5 });
    expect(level.steps[1]?.change).toBe('unchanged');
    expect(level.steps[1]?.changeSessions).toBe(0);
    expect(level.steps[1]?.changePercent).toBe(0);
  });
});

describe('reported events', () => {
  it('covers every funnel event', () => {
    for (const event of FUNNEL_EVENTS) {
      expect(REPORTED_EVENTS).toContain(event);
    }
  });

  it('reads a missing total as zero', () => {
    expect(totalOf({}, 'google_open')).toBe(0);
    expect(totalOf({ google_open: 7 }, 'google_open')).toBe(7);
  });
});

describe('assembleTrend', () => {
  /** 2026-08-04T19:00Z is 2026-08-05T00:30 in Asia/Kolkata, so "today" is the 5th. */
  const NOW = new Date('2026-08-04T19:00:00Z');

  function fiveDayRange(): AnalyticsRange {
    const resolution = resolveAnalyticsRange({
      from: '2026-08-01',
      to: '2026-08-05',
      timeZone: 'Asia/Kolkata',
      now: NOW,
    });
    if (!resolution.ok) throw new Error('fixture range was rejected');
    return resolution.range;
  }

  const rollup: RollupRow[] = [
    { metricDate: '2026-08-01', dimensionKey: 'google_open', metricValue: 2 },
    { metricDate: '2026-08-02', dimensionKey: 'google_open', metricValue: 5 },
    { metricDate: '2026-08-02', dimensionKey: 'qr_scan', metricValue: 11 },
    // Nothing for the 3rd: the worker omits zero rows, so this date genuinely had no activity.
  ];

  it('reads completed days from the rollup and counts today live', () => {
    const days = assembleTrend(fiveDayRange(), rollup, { google_open: 4 }, '2026-08-03');

    expect(days.map((day) => day.date)).toEqual([
      '2026-08-01',
      '2026-08-02',
      '2026-08-03',
      '2026-08-04',
      '2026-08-05',
    ]);
    expect(days.map((day) => day.live)).toEqual([false, false, false, false, true]);
    expect(days[4]?.counts).toEqual({ google_open: 4 });
    expect(days[1]?.counts).toEqual({ google_open: 5, qr_scan: 11 });
  });

  it('separates a genuinely empty day from one the rollup has not reached', () => {
    // The 3rd is inside the rollup's coverage and simply had nothing; the 4th is past the edge,
    // so its numbers are unknown. Reporting both as zero is the failure this guards against.
    const days = assembleTrend(fiveDayRange(), rollup, {}, '2026-08-03');

    expect(days[2]).toMatchObject({ date: '2026-08-03', pending: false, counts: {} });
    expect(days[3]).toMatchObject({ date: '2026-08-04', pending: true, counts: {} });
  });

  it('marks every completed day as pending when the rollup has never run', () => {
    const days = assembleTrend(fiveDayRange(), [], { qr_scan: 3 }, null);

    expect(days.map((day) => day.pending)).toEqual([true, true, true, true, false]);
    // Today is still real, because it never depended on the rollup in the first place.
    expect(days[4]).toMatchObject({ live: true, counts: { qr_scan: 3 } });
  });

  it('ignores rollup rows for dimensions this screen does not report', () => {
    const days = assembleTrend(
      fiveDayRange(),
      [
        { metricDate: '2026-08-01', dimensionKey: 'admin_business_suspended', metricValue: 1 },
        { metricDate: '2026-08-01', dimensionKey: 'not_an_event', metricValue: 9 },
      ],
      {},
      '2026-08-03',
    );

    expect(days[0]?.counts).toEqual({});
  });

  it('reports a known zero rather than a gap when the gap is proven empty', () => {
    // The mirror-image failure. The worker omits zero-valued rows, so a tenant who recorded
    // nothing on the 4th produces no row for it and `max(metric_date)` stays at the 3rd — which
    // made a perfectly healthy rollup look stalled and reported a day we DO know as unknown.
    const days = assembleTrend(fiveDayRange(), rollup, { qr_scan: 1 }, '2026-08-03', true);

    expect(days[3]).toMatchObject({ date: '2026-08-04', pending: false, counts: {} });
    // Summarised days and today are untouched by the flag.
    expect(days[1]?.counts).toEqual({ google_open: 5, qr_scan: 11 });
    expect(days[4]).toMatchObject({ live: true, pending: false, counts: { qr_scan: 1 } });
  });

  it('still reports a gap when the caller has not proven it empty', () => {
    // The default is PENDING, so a caller that cannot run the live count inherits the honest
    // answer rather than a claim it never checked.
    expect(assembleTrend(fiveDayRange(), rollup, {}, '2026-08-03')[3]?.pending).toBe(true);
    expect(assembleTrend(fiveDayRange(), rollup, {}, '2026-08-03', false)[3]?.pending).toBe(true);
  });

  it('does not treat today as summarised even when the rollup claims to cover it', () => {
    // A rollup row for the current local day would be a partial day stored as a whole one. The
    // live count wins, which is the reader's half of the worker's completed-days-only rule.
    const days = assembleTrend(
      fiveDayRange(),
      [{ metricDate: '2026-08-05', dimensionKey: 'google_open', metricValue: 99 }],
      { google_open: 4 },
      '2026-08-05',
    );

    expect(days[4]?.counts).toEqual({ google_open: 4 });
    expect(days[4]?.live).toBe(true);
  });
});

describe('pendingRollupGap', () => {
  /** 2026-08-04T19:00Z is 2026-08-05T00:30 in Asia/Kolkata, so "today" is the 5th. */
  const NOW = new Date('2026-08-04T19:00:00Z');

  function rangeOf(from: string, to: string): AnalyticsRange {
    const resolution = resolveAnalyticsRange({ from, to, timeZone: 'Asia/Kolkata', now: NOW });
    if (!resolution.ok) throw new Error('fixture range was rejected');
    return resolution.range;
  }

  it('spans the completed days past the rollup edge, as one absolute window', () => {
    const gap = pendingRollupGap(rangeOf('2026-08-01', '2026-08-05'), '2026-08-02');

    expect(gap).toMatchObject({ from: '2026-08-03', to: '2026-08-04' });
    // Asia/Kolkata days start at 18:30 the previous UTC day (AC-026). The window is half-open and
    // stops at the start of today, so it can never include the live day's events.
    expect(gap?.startUtc.toISOString()).toBe('2026-08-02T18:30:00.000Z');
    expect(gap?.endUtc.toISOString()).toBe('2026-08-04T18:30:00.000Z');
    expect(gap?.withinEventRetention).toBe(true);
  });

  it('starts at the range when the rollup has never run', () => {
    expect(pendingRollupGap(rangeOf('2026-08-01', '2026-08-05'), null)).toMatchObject({
      from: '2026-08-01',
      to: '2026-08-04',
    });
  });

  it('ignores a rollup edge older than the range', () => {
    expect(pendingRollupGap(rangeOf('2026-08-01', '2026-08-05'), '2026-06-01')).toMatchObject({
      from: '2026-08-01',
      to: '2026-08-04',
    });
  });

  it('is null when the rollup already covers every completed day', () => {
    expect(pendingRollupGap(rangeOf('2026-08-01', '2026-08-05'), '2026-08-04')).toBeNull();
    // A rollup that has somehow run ahead of the range leaves nothing to ask about either.
    expect(pendingRollupGap(rangeOf('2026-08-01', '2026-08-05'), '2026-09-01')).toBeNull();
  });

  it('is null when no day in the range has finished', () => {
    expect(pendingRollupGap(rangeOf('2026-08-05', '2026-08-05'), null)).toBeNull();
  });

  it('refuses to vouch for a gap older than the 13-month event window', () => {
    // Rollup rows outlive the events they were built from, so a live count of zero there means the
    // rows were purged, not that nothing happened. Reporting those days as zero would invent data.
    const today = { year: 2026, month: 8, day: 5 };
    const from = formatLocalDate(addDays(today, -(EVENT_RETENTION_DAYS + 4)));
    const to = formatLocalDate(addDays(today, -(EVENT_RETENTION_DAYS - 6)));

    expect(pendingRollupGap(rangeOf(from, to), null)?.withinEventRetention).toBe(false);
  });
});

describe('toSeries', () => {
  const days: TrendDay[] = [
    { date: '2026-08-01', pending: false, live: false, counts: { google_open: 4 } },
    { date: '2026-08-02', pending: false, live: false, counts: {} },
    { date: '2026-08-03', pending: true, live: false, counts: {} },
    { date: '2026-08-04', pending: false, live: true, counts: { google_open: 9 } },
  ];

  it('distinguishes a day with no activity from a day not yet summarised', () => {
    // This is the whole reason TrendDay carries `pending`. A day the nightly rollup has not
    // reached is unknown, not zero, and drawing it as zero would tell an owner their standees
    // had stopped working.
    const series = toSeries(days, 'google_open', 'Google review page opened');

    expect(series.points.map((point) => point.value)).toEqual([4, 0, null, 9]);
  });

  it('excludes unknown days from the maximum and the total', () => {
    const series = toSeries(days, 'google_open', 'Google review page opened');

    expect(series.max).toBe(9);
    expect(series.total).toBe(13);
  });

  it('has a zero maximum when every day is unknown, so a caller can refuse to draw', () => {
    const series = toSeries(
      days.map((day) => ({ ...day, pending: true, counts: {} })),
      'google_open',
      'Google review page opened',
    );

    expect(series.max).toBe(0);
    expect(series.total).toBe(0);
    expect(series.points.every((point) => point.value === null)).toBe(true);
  });
});

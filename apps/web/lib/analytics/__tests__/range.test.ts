import { describe, expect, it } from 'vitest';
import {
  addDays,
  DEFAULT_RANGE_DAYS,
  DEFAULT_TIME_ZONE,
  EVENT_RETENTION_DAYS,
  formatLocalDate,
  inclusiveDayCount,
  lastCompletedDay,
  localDateOf,
  MAX_RANGE_DAYS,
  parseLocalDate,
  resolveAnalyticsRange,
  resolveTimeZone,
  zonedStartOfDay,
  type AnalyticsRange,
} from '../range';

/**
 * AC-026 is the reason this file exists: "Date filters use business-local configured timezone or
 * documented default Asia/Kolkata."
 *
 * The evening cases are the ones that matter. Every assertion below that uses 19:00Z with
 * Asia/Kolkata fails outright against a UTC implementation, because 19:00Z is already 00:30 the
 * next morning in India — which is the busiest part of a restaurant's day landing on the wrong
 * side of the day boundary.
 */

/** 2026-08-29T19:00Z is 2026-08-30T00:30 in Asia/Kolkata (UTC+05:30). */
const EVENING_IN_INDIA = new Date('2026-08-29T19:00:00Z');

/**
 * Fixed instant used by the DST case, well after the September window it asserts over.
 *
 * It has to be injected. `resolveAnalyticsRange` clamps both ends to the tenant's today, so
 * passing `new Date()` made the range the test exercised depend on the wall clock: run before
 * 2026-09-02 the whole window collapsed to a single day, `gaps` was empty, and the loop asserting
 * 23/24/25-hour spacing ran zero times — a test that could not fail.
 */
const AFTER_SANTIAGO_SPRING_FORWARD = new Date('2026-10-01T00:00:00Z');

function okRange(...args: Parameters<typeof resolveAnalyticsRange>): AnalyticsRange {
  const resolution = resolveAnalyticsRange(...args);
  if (!resolution.ok) throw new Error(`expected an accepted range, got ${resolution.reason}`);
  return resolution.range;
}

describe('local day boundaries', () => {
  it('files a late-evening instant under the business-local day, not the UTC one', () => {
    expect(localDateOf(EVENING_IN_INDIA, 'Asia/Kolkata')).toEqual({
      year: 2026,
      month: 8,
      day: 30,
    });
    expect(localDateOf(EVENING_IN_INDIA, 'UTC')).toEqual({ year: 2026, month: 8, day: 29 });
  });

  it('starts an Asia/Kolkata day at 18:30 the previous UTC day', () => {
    expect(zonedStartOfDay({ year: 2026, month: 8, day: 30 }, 'Asia/Kolkata').toISOString()).toBe(
      '2026-08-29T18:30:00.000Z',
    );
  });

  it('produces days that abut exactly across a DST transition', () => {
    // America/Santiago springs forward across local midnight in early September, which is the
    // case that breaks a single-pass offset calculation: local 00:00 does not exist that day.
    // The invariant asserted is the one the data depends on — consecutive days touch, so no
    // instant can fall into two days or into none.
    const zone = 'America/Santiago';
    const range = okRange({
      from: '2026-09-01',
      to: '2026-09-10',
      timeZone: zone,
      now: AFTER_SANTIAGO_SPRING_FORWARD,
    });

    // Guards the guard: the assertions below are vacuous on an empty or single-day range, which is
    // exactly what a clamped `now` used to produce.
    expect(range.days).toHaveLength(10);

    const starts = range.days.map((day) => {
      const parsed = parseLocalDate(day);
      if (!parsed) throw new Error(`range produced an unparseable day: ${day}`);
      return zonedStartOfDay(parsed, zone).getTime();
    });

    const gaps = starts.slice(1).map((start, index) => start - (starts[index] ?? 0));
    expect(gaps).toHaveLength(9);
    // The transition is inside the window, so at least one day is not 24 hours long. Without this
    // the loop below would pass just as happily on ten ordinary days in a zone with no DST at all.
    expect(gaps.some((gap) => gap !== 24 * 3_600_000)).toBe(true);
    for (const gap of gaps) {
      // 23, 24 or 25 hours — never zero (which would mean two days share a start) and never 48
      // (which would mean a day was skipped).
      expect(gap).toBeGreaterThanOrEqual(23 * 3_600_000);
      expect(gap).toBeLessThanOrEqual(25 * 3_600_000);
    }

    expect(range.startUtc.getTime()).toBe(starts[0]);
    expect(range.endUtc.getTime()).toBeGreaterThan(starts[starts.length - 1] ?? 0);
  });
});

describe('resolveTimeZone', () => {
  it('keeps a valid IANA zone', () => {
    expect(resolveTimeZone('Europe/London')).toEqual({
      timeZone: 'Europe/London',
      usedDefault: false,
    });
  });

  it('substitutes the documented default for an unusable zone and says so', () => {
    // businesses.timezone is a free-form varchar, so this is reachable from bad data rather than
    // only from a bug. AC-026 allows the documented default; it does not allow a crash.
    // 'IST' is deliberately not in this list: Intl accepts it as a legacy alias, so it resolves
    // rather than substituting, and asserting otherwise would pin a fiction.
    for (const bad of ['Mars/Olympus', '', 'Asia/Kolkatta', 'UTC+5:30']) {
      expect(resolveTimeZone(bad)).toEqual({ timeZone: DEFAULT_TIME_ZONE, usedDefault: true });
    }
    expect(resolveTimeZone(null)).toEqual({ timeZone: DEFAULT_TIME_ZONE, usedDefault: true });
  });
});

describe('parseLocalDate', () => {
  it('accepts a real calendar date', () => {
    expect(parseLocalDate('2026-02-28')).toEqual({ year: 2026, month: 2, day: 28 });
    expect(parseLocalDate('2024-02-29')).toEqual({ year: 2024, month: 2, day: 29 });
  });

  it('rejects a date that does not exist rather than rolling it over', () => {
    // Date.UTC(2026, 1, 30) is happily 2 March. Without the round-trip check the endpoint would
    // answer for a different day than the caller asked about.
    expect(parseLocalDate('2026-02-30')).toBeNull();
    expect(parseLocalDate('2026-02-29')).toBeNull();
    expect(parseLocalDate('2026-13-01')).toBeNull();
    expect(parseLocalDate('2026-00-10')).toBeNull();
  });

  it('rejects anything that is not strict YYYY-MM-DD', () => {
    for (const bad of [
      '2026-1-1',
      '20260101',
      '2026/01/01',
      'yesterday',
      '',
      '2026-01-01T00:00Z',
    ]) {
      expect(parseLocalDate(bad)).toBeNull();
    }
  });
});

describe('resolveAnalyticsRange', () => {
  it('defaults to the last 30 business-local days, ending on the local today', () => {
    const range = okRange({ timeZone: 'Asia/Kolkata', now: EVENING_IN_INDIA });

    expect(range.to).toBe('2026-08-30');
    expect(range.from).toBe('2026-08-01');
    expect(range.days).toHaveLength(DEFAULT_RANGE_DAYS);
    expect(range.today).toBe('2026-08-30');
    expect(range.includesToday).toBe(true);
    expect(range.todayStartUtc?.toISOString()).toBe('2026-08-29T18:30:00.000Z');
    expect(range.startUtc.toISOString()).toBe('2026-07-31T18:30:00.000Z');
    expect(range.endUtc.toISOString()).toBe('2026-08-30T18:30:00.000Z');
  });

  it('reports the zone it used so the UI can name it', () => {
    expect(okRange({ timeZone: 'Asia/Kolkata', now: EVENING_IN_INDIA }).usedDefaultTimeZone).toBe(
      false,
    );
    expect(okRange({ timeZone: 'Nowhere/Real', now: EVENING_IN_INDIA }).usedDefaultTimeZone).toBe(
      true,
    );
  });

  it('marks a range that ends before today as not including it', () => {
    const range = okRange({
      from: '2026-08-01',
      to: '2026-08-07',
      timeZone: 'Asia/Kolkata',
      now: EVENING_IN_INDIA,
    });

    expect(range.includesToday).toBe(false);
    expect(range.todayStartUtc).toBeNull();
    expect(range.days).toHaveLength(7);
  });

  it('clamps a future end date to today instead of refusing it', () => {
    // A native date picker produces a future date with one keystroke; refusing it teaches the
    // owner nothing.
    const range = okRange({
      from: '2026-08-20',
      to: '2026-12-31',
      timeZone: 'Asia/Kolkata',
      now: EVENING_IN_INDIA,
    });

    expect(range.to).toBe('2026-08-30');
    expect(range.clampedFuture).toBe(true);
  });

  it('clamps both ends, so a wholly future range becomes today rather than a reversed one', () => {
    const range = okRange({
      from: '2030-01-01',
      to: '2030-01-31',
      timeZone: 'Asia/Kolkata',
      now: EVENING_IN_INDIA,
    });

    expect(range.from).toBe('2026-08-30');
    expect(range.to).toBe('2026-08-30');
    expect(range.days).toEqual(['2026-08-30']);
  });

  it('rejects a reversed range rather than quietly swapping the ends', () => {
    const resolution = resolveAnalyticsRange({
      from: '2026-08-20',
      to: '2026-08-10',
      timeZone: 'Asia/Kolkata',
      now: EVENING_IN_INDIA,
    });

    expect(resolution).toMatchObject({ ok: false, reason: 'REVERSED' });
  });

  it('rejects a malformed date, naming the field that was wrong', () => {
    expect(resolveAnalyticsRange({ from: '2026-02-30', now: EVENING_IN_INDIA })).toMatchObject({
      ok: false,
      reason: 'INVALID_DATE',
      fields: ['from'],
    });

    expect(resolveAnalyticsRange({ to: 'last-week', now: EVENING_IN_INDIA })).toMatchObject({
      ok: false,
      reason: 'INVALID_DATE',
      fields: ['to'],
    });
  });

  it('accepts exactly MAX_RANGE_DAYS and rejects one more', () => {
    const to = { year: 2026, month: 8, day: 30 };
    const longest = formatLocalDate(addDays(to, -(MAX_RANGE_DAYS - 1)));
    const tooLong = formatLocalDate(addDays(to, -MAX_RANGE_DAYS));

    expect(
      okRange({ from: longest, to: '2026-08-30', timeZone: 'Asia/Kolkata', now: EVENING_IN_INDIA }),
    ).toMatchObject({ from: longest });

    expect(
      resolveAnalyticsRange({
        from: tooLong,
        to: '2026-08-30',
        timeZone: 'Asia/Kolkata',
        now: EVENING_IN_INDIA,
      }),
    ).toMatchObject({ ok: false, reason: 'TOO_LONG' });
  });

  it('flags a range that reaches past the 13-month event retention window', () => {
    const inside = okRange({
      from: '2026-01-01',
      to: '2026-06-01',
      timeZone: 'Asia/Kolkata',
      now: EVENING_IN_INDIA,
    });
    expect(inside.beyondEventRetention).toBe(false);

    // Rollup rows outlive the raw events they were built from, so a range this old can show
    // trend numbers with no live figures behind them. The flag is what lets the screen say so.
    const edge = formatLocalDate(addDays({ year: 2026, month: 8, day: 30 }, -EVENT_RETENTION_DAYS));
    const outside = okRange({
      from: edge,
      to: formatLocalDate(addDays({ year: 2026, month: 8, day: 30 }, -EVENT_RETENTION_DAYS + 120)),
      timeZone: 'Asia/Kolkata',
      now: EVENING_IN_INDIA,
    });
    expect(outside.beyondEventRetention).toBe(true);
  });

  it('treats a single day as one day, not zero', () => {
    const range = okRange({
      from: '2026-08-10',
      to: '2026-08-10',
      timeZone: 'Asia/Kolkata',
      now: EVENING_IN_INDIA,
    });

    expect(range.days).toEqual(['2026-08-10']);
    expect(
      inclusiveDayCount({ year: 2026, month: 8, day: 10 }, { year: 2026, month: 8, day: 10 }),
    ).toBe(1);
  });
});

describe('lastCompletedDay', () => {
  it('is yesterday when the range runs up to today', () => {
    const range = okRange({ timeZone: 'Asia/Kolkata', now: EVENING_IN_INDIA });
    expect(lastCompletedDay(range)).toBe('2026-08-29');
  });

  it('is the range end when the range already stops before today', () => {
    const range = okRange({
      from: '2026-08-01',
      to: '2026-08-07',
      timeZone: 'Asia/Kolkata',
      now: EVENING_IN_INDIA,
    });
    expect(lastCompletedDay(range)).toBe('2026-08-07');
  });

  it('is null when the range is only today, because no day in it has finished', () => {
    const range = okRange({
      from: '2026-08-30',
      to: '2026-08-30',
      timeZone: 'Asia/Kolkata',
      now: EVENING_IN_INDIA,
    });
    expect(lastCompletedDay(range)).toBeNull();
  });
});

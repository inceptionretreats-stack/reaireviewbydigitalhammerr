import { describe, expect, it } from 'vitest';
import {
  addDays,
  completedDaysBefore,
  dayWindow,
  DEFAULT_TIME_ZONE,
  formatLocalDate,
  localDateOf,
  resolveTimeZone,
  zoneOffsetMs,
} from '../jobs/analytics/date-bucket';

/**
 * AC-026. These are the tests that catch a UTC day boundary silently replacing a
 * business-local one — a defect that produces plausible-looking numbers indefinitely.
 */

const KOLKATA = 'Asia/Kolkata';

describe('business-local day boundaries (AC-026)', () => {
  it('resolves an Asia/Kolkata day to its absolute window', () => {
    const window = dayWindow({ year: 2026, month: 8, day: 29 }, KOLKATA);

    // IST is UTC+05:30, so the local day starts at 18:30 the previous UTC day.
    expect(window.startUtc.toISOString()).toBe('2026-08-28T18:30:00.000Z');
    expect(window.endUtc.toISOString()).toBe('2026-08-29T18:30:00.000Z');
    expect(window.metricDate).toBe('2026-08-29');
  });

  /**
   * The headline case. This one instant is the 28th in UTC and the 29th in the business's own
   * timezone, and AC-026 says the dashboard shows the 29th.
   */
  it('files a late-evening UTC instant under the next business-local day', () => {
    const instant = new Date('2026-08-28T19:00:00.000Z');

    expect(formatLocalDate(localDateOf(instant, KOLKATA))).toBe('2026-08-29');
    expect(formatLocalDate(localDateOf(instant, 'UTC'))).toBe('2026-08-28');

    const window = dayWindow({ year: 2026, month: 8, day: 29 }, KOLKATA);
    expect(instant.getTime()).toBeGreaterThanOrEqual(window.startUtc.getTime());
    expect(instant.getTime()).toBeLessThan(window.endUtc.getTime());
  });

  it('reports the IST offset as five and a half hours', () => {
    expect(zoneOffsetMs(new Date('2026-08-29T00:00:00.000Z'), KOLKATA)).toBe(5.5 * 3_600_000);
  });

  it('gives the same instant different local dates for tenants in different timezones', () => {
    const instant = new Date('2026-08-28T19:00:00.000Z');

    expect(formatLocalDate(localDateOf(instant, KOLKATA))).toBe('2026-08-29');
    expect(formatLocalDate(localDateOf(instant, 'America/Los_Angeles'))).toBe('2026-08-28');
    expect(formatLocalDate(localDateOf(instant, 'Pacific/Kiritimati'))).toBe('2026-08-29');
  });
});

describe('completedDaysBefore', () => {
  it('returns only days that have fully elapsed, oldest first', () => {
    // 07:30 on the 30th in Kolkata, so the 29th and 28th are both complete and the 30th is not.
    const windows = completedDaysBefore(new Date('2026-08-30T02:00:00.000Z'), KOLKATA, 2);

    expect(windows.map((window) => window.metricDate)).toEqual(['2026-08-28', '2026-08-29']);
  });

  /**
   * A single UTC schedule serves every timezone only if this holds. If a window could end in
   * the future the job would store a partial day, which is indistinguishable from a complete
   * one once written.
   */
  it('never returns a window that ends in the future, in any timezone', () => {
    const now = new Date('2026-08-30T00:20:00.000Z');
    const zones = [
      KOLKATA,
      'UTC',
      'America/Los_Angeles',
      'Pacific/Kiritimati',
      'Pacific/Midway',
      'Australia/Lord_Howe',
      'America/Santiago',
    ];

    for (const zone of zones) {
      for (const window of completedDaysBefore(now, zone, 3)) {
        expect(window.endUtc.getTime()).toBeLessThanOrEqual(now.getTime());
      }
    }
  });
});

describe('daylight saving', () => {
  /**
   * The invariant that protects the data: consecutive windows abut exactly. Any gap loses
   * events, any overlap counts them twice, and neither would ever be noticed in a rollup.
   */
  it('produces contiguous windows across every day of a year in DST zones', () => {
    const zones = ['America/New_York', 'America/Santiago', 'Australia/Lord_Howe', KOLKATA];

    for (const zone of zones) {
      let date = { year: 2026, month: 1, day: 1 };
      let previousEnd: number | null = null;

      for (let index = 0; index < 365; index += 1) {
        const window = dayWindow(date, zone);

        if (previousEnd !== null) {
          expect(window.startUtc.getTime()).toBe(previousEnd);
        }
        expect(window.endUtc.getTime()).toBeGreaterThan(window.startUtc.getTime());

        // The window's own start and midpoint must both fall on the date it claims, or the
        // metric_date written for it is a lie.
        expect(formatLocalDate(localDateOf(window.startUtc, zone))).toBe(window.metricDate);
        const midpoint = new Date((window.startUtc.getTime() + window.endUtc.getTime()) / 2);
        expect(formatLocalDate(localDateOf(midpoint, zone))).toBe(window.metricDate);

        previousEnd = window.endUtc.getTime();
        date = addDays(date, 1);
      }
    }
  });

  it('gives a 23-hour day on spring forward and a 25-hour day on fall back', () => {
    const hours = (year: number, month: number, day: number): number => {
      const window = dayWindow({ year, month, day }, 'America/New_York');
      return (window.endUtc.getTime() - window.startUtc.getTime()) / 3_600_000;
    };

    // US DST 2026: begins 8 March, ends 1 November.
    expect(hours(2026, 3, 8)).toBe(23);
    expect(hours(2026, 11, 1)).toBe(25);
    expect(hours(2026, 6, 15)).toBe(24);
  });
});

describe('resolveTimeZone', () => {
  it('falls back to the documented default rather than throwing', () => {
    // businesses.timezone is free-form varchar, and one bad row must not take the nightly
    // rollup down for every other tenant.
    expect(resolveTimeZone('Mars/Olympus_Mons')).toBe(DEFAULT_TIME_ZONE);
    expect(resolveTimeZone(null)).toBe(DEFAULT_TIME_ZONE);
    expect(resolveTimeZone('')).toBe(DEFAULT_TIME_ZONE);
    expect(DEFAULT_TIME_ZONE).toBe('Asia/Kolkata');
  });

  it('keeps a valid zone and honours an explicit fallback', () => {
    expect(resolveTimeZone('America/New_York')).toBe('America/New_York');
    expect(resolveTimeZone('nonsense', 'UTC')).toBe('UTC');
  });
});

describe('addDays', () => {
  it('crosses month and year boundaries', () => {
    expect(formatLocalDate(addDays({ year: 2026, month: 1, day: 31 }, 1))).toBe('2026-02-01');
    expect(formatLocalDate(addDays({ year: 2026, month: 3, day: 1 }, -1))).toBe('2026-02-28');
    expect(formatLocalDate(addDays({ year: 2024, month: 3, day: 1 }, -1))).toBe('2024-02-29');
    expect(formatLocalDate(addDays({ year: 2026, month: 1, day: 1 }, -1))).toBe('2025-12-31');
  });
});

import { describe, expect, it } from 'vitest';
import {
  addMonths,
  DEFAULT_PARTITION_NAME,
  firstDayOf,
  firstRetainedMonth,
  monthsToEnsure,
  parsePartitionName,
  partitionNameFor,
  planPartitionDrops,
} from '../jobs/partitions/window';

/**
 * Retention arithmetic. A wrong cutoff here deletes tenant history irreversibly and silently,
 * so the boundary month is pinned explicitly rather than left to a round-trip through the
 * implementation.
 */

const AUG_29_2026 = new Date('2026-08-29T03:10:00.000Z');

describe('retention window', () => {
  /**
   * The off-by-one-month trap. With 13-month retention on 29 August 2026, the naive cutoff
   * "drop everything before 2025-08" would drop analytics_events_2025_07 — whose newest row is
   * 31 July 2025, twelve months and twenty-nine days old, still inside the 13 months
   * 13_Security_Privacy_Compliance.md promises to keep.
   */
  it('keeps the month whose newest rows are not yet past the retention period', () => {
    expect(firstRetainedMonth(AUG_29_2026, 13)).toEqual({ year: 2025, month: 7 });

    const plan = planPartitionDrops(
      ['analytics_events_2025_06', 'analytics_events_2025_07', 'analytics_events_2025_08'],
      AUG_29_2026,
      13,
      10,
    );

    expect(plan.drop).toEqual(['analytics_events_2025_06']);
    expect(plan.drop).not.toContain('analytics_events_2025_07');
  });

  it('holds the same boundary on the first and last day of the month', () => {
    expect(firstRetainedMonth(new Date('2026-08-01T00:00:00.000Z'), 13)).toEqual({
      year: 2025,
      month: 7,
    });
    expect(firstRetainedMonth(new Date('2026-08-31T23:59:59.000Z'), 13)).toEqual({
      year: 2025,
      month: 7,
    });
  });

  /**
   * Even at the minimum retention the rule holds: with two months' retention on 29 August,
   * June is still within the window (its newest row is 29 days old at the start of the
   * window), so only May and earlier are eligible. The current and future months can never be.
   */
  it('never proposes the current or a future month, even at minimum retention', () => {
    const plan = planPartitionDrops(
      [
        'analytics_events_2026_05',
        'analytics_events_2026_06',
        'analytics_events_2026_07',
        'analytics_events_2026_08',
        'analytics_events_2026_09',
      ],
      AUG_29_2026,
      2,
      10,
    );

    expect(plan.drop).toEqual(['analytics_events_2026_05']);
    expect(plan.drop).not.toContain('analytics_events_2026_08');
    expect(plan.drop).not.toContain('analytics_events_2026_09');
  });

  it('drops oldest first and defers the rest to the per-run cap', () => {
    const plan = planPartitionDrops(
      [
        'analytics_events_2025_06',
        'analytics_events_2025_04',
        'analytics_events_2025_05',
        'analytics_events_2026_08',
      ],
      AUG_29_2026,
      13,
      2,
    );

    expect(plan.drop).toEqual(['analytics_events_2025_04', 'analytics_events_2025_05']);
    expect(plan.deferred).toEqual(['analytics_events_2025_06']);
  });

  it('refuses every name it does not positively recognise', () => {
    const plan = planPartitionDrops(
      [
        DEFAULT_PARTITION_NAME,
        'analytics_events_2025_13',
        'analytics_events_2025_1',
        'analytics_events_2025_06_backup',
        'analytics_events',
        'businesses',
      ],
      AUG_29_2026,
      13,
      10,
    );

    expect(plan.drop).toEqual([]);
    expect(plan.unrecognised).toHaveLength(6);
  });

  it('never treats the DEFAULT partition as dated', () => {
    // AC-035 depends on it existing, and it carries no month to reason about.
    expect(parsePartitionName(DEFAULT_PARTITION_NAME)).toBeNull();
  });
});

describe('partition naming and month arithmetic', () => {
  it('round-trips the names ensure_analytics_events_partition creates', () => {
    expect(partitionNameFor({ year: 2026, month: 9 })).toBe('analytics_events_2026_09');
    expect(parsePartitionName('analytics_events_2026_09')).toEqual({ year: 2026, month: 9 });
    expect(firstDayOf({ year: 2026, month: 9 })).toBe('2026-09-01');
  });

  it('crosses year boundaries in both directions', () => {
    expect(addMonths({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
    expect(addMonths({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
    expect(addMonths({ year: 2026, month: 8 }, -13)).toEqual({ year: 2025, month: 7 });
  });

  it('ensures the current month and the requested lead months', () => {
    expect(monthsToEnsure(AUG_29_2026, 3).map(partitionNameFor)).toEqual([
      'analytics_events_2026_08',
      'analytics_events_2026_09',
      'analytics_events_2026_10',
      'analytics_events_2026_11',
    ]);
  });
});

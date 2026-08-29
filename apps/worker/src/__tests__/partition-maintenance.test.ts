import { describe, expect, it } from 'vitest';
import { PartitionMaintenanceJob } from '../jobs/partitions/maintain';
import { MemoryPartitionStore } from '../jobs/partitions/memory-store';
import { DEFAULT_PARTITION_NAME } from '../jobs/partitions/window';
import { harness } from './support/harness';

const NOW = '2026-08-29T03:10:00.000Z';

function storeWithHistory(): MemoryPartitionStore {
  const store = new MemoryPartitionStore();
  store.seed(DEFAULT_PARTITION_NAME, 0);
  store.seed('analytics_events_2025_05', 12_000_000);
  store.seed('analytics_events_2025_06', 13_000_000);
  store.seed('analytics_events_2025_07', 14_000_000);
  store.seed('analytics_events_2026_08', 900_000);
  return store;
}

function job(store: MemoryPartitionStore, dropEnabled: boolean, maxDropsPerRun = 1) {
  return new PartitionMaintenanceJob(store, {
    monthsAhead: 3,
    retentionMonths: 13,
    dropEnabled,
    maxDropsPerRun,
  });
}

describe('partition maintenance', () => {
  it('pre-creates the current month and the lead months', async () => {
    const store = storeWithHistory();
    await job(store, false).run(harness(NOW).context);

    for (const name of [
      'analytics_events_2026_08',
      'analytics_events_2026_09',
      'analytics_events_2026_10',
      'analytics_events_2026_11',
    ]) {
      expect(store.has(name)).toBe(true);
    }
  });

  it('drops nothing while dropping is disabled, but reports what it would drop', async () => {
    const store = storeWithHistory();
    const test = harness(NOW);

    const summary = await job(store, false).run(test.context);

    expect(store.dropped).toEqual([]);
    expect(summary.wouldDrop).toBe('analytics_events_2025_05');
    expect(summary.dropped).toBe('');
    expect(store.has('analytics_events_2025_05')).toBe(true);
  });

  /** Nothing is dropped without a warn-level line naming it first; afterwards it is the only record. */
  it('logs the partition, its row count and the cutoff before dropping it', async () => {
    const store = storeWithHistory();
    const test = harness(NOW);

    await job(store, true).run(test.context);

    const announcement = test.sink
      .entries()
      .find(
        (entry) => entry.msg === 'dropping analytics_events partition past the retention window',
      );

    expect(announcement).toMatchObject({
      level: 'warn',
      partition: 'analytics_events_2025_05',
      rows: 12_000_000,
      retentionMonths: 13,
      firstRetainedMonth: '2025-07',
      dryRun: false,
    });
  });

  it('drops the oldest partition first and honours the per-run cap', async () => {
    const store = storeWithHistory();
    await job(store, true, 1).run(harness(NOW).context);

    expect(store.dropped).toEqual(['analytics_events_2025_05']);
    // 2025-07 is inside the retention window; 2025-06 is eligible but deferred by the cap.
    expect(store.has('analytics_events_2025_06')).toBe(true);
    expect(store.has('analytics_events_2025_07')).toBe(true);
  });

  it('never drops the DEFAULT partition', async () => {
    const store = storeWithHistory();
    await job(store, true, 12).run(harness(NOW).context);

    expect(store.dropped).not.toContain(DEFAULT_PARTITION_NAME);
    expect(store.has(DEFAULT_PARTITION_NAME)).toBe(true);
  });

  /**
   * Rows in the DEFAULT partition mean a month partition was missing when they arrived
   * (AMENDMENT-012). Never fatal — AC-035 is exactly why the catch-all exists — but it must be
   * visible.
   */
  it('warns when events have landed in the DEFAULT partition', async () => {
    const store = storeWithHistory();
    store.seed(DEFAULT_PARTITION_NAME, 41);
    const test = harness(NOW);

    const summary = await job(store, false).run(test.context);

    expect(summary.defaultPartitionRows).toBe(41);
    expect(test.sink.messages('warn')).toContain(
      'events landed in the DEFAULT analytics partition',
    );
  });
});

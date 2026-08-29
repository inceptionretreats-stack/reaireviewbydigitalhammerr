import { describe, expect, it } from 'vitest';
import { createLogger } from '../logger';
import { SCHEDULES, SCHEDULE_TIME_ZONE, JOB_NAMES } from '../queue/names';
import { MemoryJobScheduler, reconcileSchedules } from '../queue/scheduler';
import { RecordingSink } from './support/harness';

function logger() {
  return createLogger('debug', new RecordingSink());
}

describe('schedule reconciliation', () => {
  it('registers every declared schedule', async () => {
    const scheduler = new MemoryJobScheduler();

    const result = await reconcileSchedules(scheduler, SCHEDULES, logger());

    expect(result.upserted).toHaveLength(SCHEDULES.length);
    for (const spec of SCHEDULES) {
      expect(scheduler.has(spec.id)).toBe(true);
    }
  });

  /**
   * The half that matters. Repeatable schedules live in Redis, not in the deployment, so a
   * retired job keeps firing against a handler that no longer exists until something removes
   * it. Reconciling on every boot is what makes the code win.
   */
  it('prunes a schedule the current build no longer declares', async () => {
    const scheduler = new MemoryJobScheduler();
    scheduler.seed({
      id: 'asset-export-v0',
      jobName: JOB_NAMES.sessionPurge,
      cron: '0 * * * *',
      timeZone: SCHEDULE_TIME_ZONE,
      why: 'A schedule left behind by an earlier release.',
    });

    const result = await reconcileSchedules(scheduler, SCHEDULES, logger());

    expect(result.removed).toEqual(['asset-export-v0']);
    expect(scheduler.has('asset-export-v0')).toBe(false);
    expect(scheduler.size).toBe(SCHEDULES.length);
  });

  it('is idempotent across restarts', async () => {
    const scheduler = new MemoryJobScheduler();

    await reconcileSchedules(scheduler, SCHEDULES, logger());
    const second = await reconcileSchedules(scheduler, SCHEDULES, logger());

    expect(second.removed).toEqual([]);
    expect(scheduler.size).toBe(SCHEDULES.length);
  });
});

describe('schedule table', () => {
  it('declares a schedule for every job the architecture assigns the worker', () => {
    const scheduled = new Set(SCHEDULES.map((spec) => spec.jobName));
    expect(scheduled).toEqual(new Set(Object.values(JOB_NAMES)));
  });

  it('pins every cron to UTC', () => {
    // A container inherits its base image's timezone; a schedule that silently shifts by
    // 5h30m after an image bump is an outage found weeks later.
    for (const spec of SCHEDULES) {
      expect(spec.timeZone).toBe('Etc/UTC');
    }
  });

  it('uses unique schedule ids', () => {
    expect(new Set(SCHEDULES.map((spec) => spec.id)).size).toBe(SCHEDULES.length);
  });
});

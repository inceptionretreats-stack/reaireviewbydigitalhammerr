import { describe, expect, it } from 'vitest';
import { MemoryQuotaStore } from '../memory-store';
import { QuotaService } from '../service';

const BIZ = 'business-1';

function freeService(used = 0, racy = false) {
  const store = new MemoryQuotaStore(racy);
  store.seed(BIZ, { mode: 'FREE', used, limit: 10 });
  return { store, service: new QuotaService(store) };
}

describe('quota reservation', () => {
  it('allows a generation while quota remains', async () => {
    const { service } = freeService();
    const outcome = await service.reserve(BIZ);

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.reservation.counted).toBe(true);
      expect(outcome.reservation.usedAfterReserve).toBe(1);
    }
  });

  it('denies once the limit is reached', async () => {
    const { service } = freeService(10);
    const outcome = await service.reserve(BIZ);

    expect(outcome).toMatchObject({ ok: false, reason: 'PLAN_QUOTA_EXHAUSTED' });
  });

  /**
   * AC-013, the headline case. Eleven requests arrive together against a fresh Free business;
   * exactly ten may succeed.
   */
  it('admits exactly 10 of 11 concurrent requests', async () => {
    const { store, service } = freeService();

    const outcomes = await Promise.all(Array.from({ length: 11 }, () => service.reserve(BIZ)));

    expect(outcomes.filter((o) => o.ok)).toHaveLength(10);
    expect(outcomes.filter((o) => !o.ok)).toHaveLength(1);
    expect(store.usage(BIZ)).toBe(10);
  });

  it('holds the boundary under heavy concurrency', async () => {
    const { store, service } = freeService();

    const outcomes = await Promise.all(Array.from({ length: 200 }, () => service.reserve(BIZ)));

    expect(outcomes.filter((o) => o.ok)).toHaveLength(10);
    expect(store.usage(BIZ)).toBe(10);
  });

  /**
   * Proves the concurrency tests above have teeth: against a read-modify-write store the
   * boundary really is breached. If this ever starts failing, the guard has stopped guarding.
   *
   * Note what the bug actually looks like. Every racy caller reads 0, yields, and writes 1, so
   * the counter *under*-reports at 1 while eleven customers each receive a generation. The
   * harm is the eleven grants, not the counter value — so that is what is asserted.
   */
  it('detects a read-modify-write implementation', async () => {
    const { store, service } = freeService(0, true);

    const outcomes = await Promise.all(Array.from({ length: 11 }, () => service.reserve(BIZ)));

    expect(outcomes.filter((o) => o.ok).length).toBeGreaterThan(10);
    expect(store.usage(BIZ)).toBeLessThan(outcomes.filter((o) => o.ok).length);
  });
});

describe('quota release', () => {
  /** AC-014: a provider failure must not cost the customer a generation. */
  it('returns the reservation when the provider fails', async () => {
    const { store, service } = freeService();

    await expect(
      service.withReservation(BIZ, () => Promise.reject(new Error('provider down'))),
    ).rejects.toThrow('provider down');

    expect(store.usage(BIZ)).toBe(0);
  });

  it('keeps the reservation when a draft is produced', async () => {
    const { store, service } = freeService();

    const result = await service.withReservation(BIZ, () => Promise.resolve('draft text'));

    expect(result).toMatchObject({ ok: true, result: 'draft text' });
    expect(store.usage(BIZ)).toBe(1);
  });

  /**
   * An internal quality-gate retry costs two provider calls but is one customer generation
   * (09_AI_Prompt_and_Generation_Spec.md free-quota semantics).
   */
  it('counts an internal retry as a single customer generation', async () => {
    const { store, service } = freeService();
    let providerCalls = 0;

    await service.withReservation(BIZ, async () => {
      providerCalls += 1;
      await Promise.resolve();
      providerCalls += 1; // quality gate rejected the first candidate, retried once
      return 'second candidate';
    });

    expect(providerCalls).toBe(2);
    expect(store.usage(BIZ)).toBe(1);
  });

  it('never drives usage negative on a double release', async () => {
    const { store, service } = freeService();
    const outcome = await service.reserve(BIZ);
    if (!outcome.ok) throw new Error('expected reservation');

    await service.release(outcome.reservation);
    await service.release(outcome.reservation);

    expect(store.usage(BIZ)).toBe(0);
  });
});

describe('entitlement modes', () => {
  it('allows the 2,000th Pro generation and denies the next one', async () => {
    const store = new MemoryQuotaStore();
    store.seed(BIZ, { mode: 'PRO', used: 1999, limit: 2000 });
    const service = new QuotaService(store);

    const lastAllowed = await service.reserve(BIZ);
    const denied = await service.reserve(BIZ);

    expect(lastAllowed).toMatchObject({
      ok: true,
      reservation: { mode: 'PRO', counted: true, usedAfterReserve: 2000 },
    });
    expect(denied).toMatchObject({ ok: false, reason: 'PLAN_QUOTA_EXHAUSTED' });
    expect(store.usage(BIZ)).toBe(2000);
  });

  it('admits only one concurrent Pro reservation when one annual draft remains', async () => {
    const store = new MemoryQuotaStore();
    store.seed(BIZ, { mode: 'PRO', used: 1999, limit: 2000 });
    const service = new QuotaService(store);

    const outcomes = await Promise.all([service.reserve(BIZ), service.reserve(BIZ)]);

    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
    expect(outcomes.filter((outcome) => !outcome.ok)).toHaveLength(1);
    expect(store.usage(BIZ, 'PRO')).toBe(2000);
  });

  it('returns a Pro reservation when generation fails', async () => {
    const store = new MemoryQuotaStore();
    store.seed(BIZ, { mode: 'PRO', used: 87, limit: 2000 });
    const service = new QuotaService(store);

    await expect(
      service.withReservation(BIZ, () => Promise.reject(new Error('provider down'))),
    ).rejects.toThrow('provider down');

    expect(store.usage(BIZ, 'PRO')).toBe(87);
  });

  it('blocks a suspended tenant', async () => {
    const store = new MemoryQuotaStore();
    store.seed(BIZ, { mode: 'BLOCKED' });
    const service = new QuotaService(store);

    expect(await service.reserve(BIZ)).toMatchObject({
      ok: false,
      reason: 'SUBSCRIPTION_NOT_ACTIVE',
    });
  });

  it('reports an unknown business rather than throwing', async () => {
    const service = new QuotaService(new MemoryQuotaStore());
    expect(await service.reserve('nope')).toMatchObject({
      ok: false,
      reason: 'BUSINESS_NOT_ACTIVE',
    });
  });
});

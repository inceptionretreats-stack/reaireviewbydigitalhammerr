import type { Entitlement, QuotaConsumption, QuotaReservation, QuotaStore } from './types';

export interface MemoryQuotaSeed {
  mode: Entitlement['mode'];
  used?: number;
  limit?: number;
  freeUsed?: number;
  freeLimit?: number;
  proUsed?: number;
  proLimit?: number;
  softLimit?: number | null;
  periodStartsAt?: Date | null;
  periodEndsAt?: Date | null;
}

interface MemoryQuotaRow {
  mode: Entitlement['mode'];
  freeUsed: number;
  freeLimit: number;
  proUsed: number;
  proLimit: number;
  softLimit: number | null;
  periodStartsAt: Date | null;
  periodEndsAt: Date | null;
}

/**
 * In-memory store for testing the reservation algorithm without a database.
 *
 * `racy` deliberately models the read-modify-write mistake this design exists to avoid, so the
 * concurrency test can prove it actually detects the bug rather than passing vacuously.
 */
export class MemoryQuotaStore implements QuotaStore {
  private readonly rows = new Map<string, MemoryQuotaRow>();

  constructor(private readonly racy = false) {}

  seed(businessId: string, seed: MemoryQuotaSeed): void {
    const activeUsed = seed.used ?? 0;
    const activeLimit = seed.limit ?? (seed.mode === 'PRO' ? 2000 : 10);

    this.rows.set(businessId, {
      mode: seed.mode,
      freeUsed: seed.freeUsed ?? (seed.mode === 'FREE' ? activeUsed : 0),
      freeLimit: seed.freeLimit ?? (seed.mode === 'FREE' ? activeLimit : 10),
      proUsed: seed.proUsed ?? (seed.mode === 'PRO' ? activeUsed : 0),
      proLimit: seed.proLimit ?? (seed.mode === 'PRO' ? activeLimit : 2000),
      softLimit: seed.softLimit ?? null,
      periodStartsAt: seed.periodStartsAt ?? null,
      periodEndsAt: seed.periodEndsAt ?? null,
    });
  }

  getEntitlement(businessId: string): Promise<Entitlement | null> {
    const row = this.rows.get(businessId);
    if (!row) return Promise.resolve(null);

    return Promise.resolve({
      mode: row.mode,
      freeGenerationsUsed: row.freeUsed,
      freeGenerationLimit: row.freeLimit,
      proGenerationsUsed: row.proUsed,
      proGenerationLimit: row.proLimit,
      periodStartsAt: row.periodStartsAt,
      periodEndsAt: row.periodEndsAt,
      fairUseMonthlySoftLimit: row.softLimit,
    });
  }

  async tryConsume(
    businessId: string,
    mode: QuotaReservation['mode'],
  ): Promise<QuotaConsumption | null> {
    const row = this.rows.get(businessId);
    if (!row) return null;

    const usedKey = mode === 'PRO' ? 'proUsed' : 'freeUsed';
    const limitKey = mode === 'PRO' ? 'proLimit' : 'freeLimit';

    if (this.racy) {
      // The broken implementation: observe, yield, then write back.
      const observed = row[usedKey];
      await Promise.resolve();
      if (observed >= row[limitKey]) return null;
      row[usedKey] = observed + 1;
      return {
        usedAfterReserve: row[usedKey],
        periodStartsAt: mode === 'PRO' ? row.periodStartsAt : null,
      };
    }

    // The correct implementation: guard and increment with no suspension point between them,
    // which is what the single SQL statement buys in Postgres.
    if (row[usedKey] >= row[limitKey]) return null;
    row[usedKey] += 1;
    return {
      usedAfterReserve: row[usedKey],
      periodStartsAt: mode === 'PRO' ? row.periodStartsAt : null,
    };
  }

  release(reservation: QuotaReservation): Promise<void> {
    const row = this.rows.get(reservation.businessId);
    const usedKey = reservation.mode === 'PRO' ? 'proUsed' : 'freeUsed';
    if (row && row[usedKey] > 0) row[usedKey] -= 1;
    return Promise.resolve();
  }

  usage(businessId: string, mode?: QuotaReservation['mode']): number {
    const row = this.rows.get(businessId);
    if (!row) return 0;
    const selected = mode ?? (row.mode === 'PRO' ? 'PRO' : 'FREE');
    return selected === 'PRO' ? row.proUsed : row.freeUsed;
  }
}

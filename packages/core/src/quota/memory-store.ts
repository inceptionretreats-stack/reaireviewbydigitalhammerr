import type { Entitlement, QuotaStore } from './types';

export interface MemoryQuotaSeed {
  mode: Entitlement['mode'];
  used?: number;
  limit?: number;
  softLimit?: number | null;
}

/**
 * In-memory store for testing the reservation algorithm without a database.
 *
 * `racy` deliberately models the read-modify-write mistake this design exists to avoid, so the
 * concurrency test can prove it actually detects the bug rather than passing vacuously.
 */
export class MemoryQuotaStore implements QuotaStore {
  private readonly rows = new Map<string, Required<MemoryQuotaSeed>>();

  constructor(private readonly racy = false) {}

  seed(businessId: string, seed: MemoryQuotaSeed): void {
    this.rows.set(businessId, {
      mode: seed.mode,
      used: seed.used ?? 0,
      limit: seed.limit ?? 10,
      softLimit: seed.softLimit ?? null,
    });
  }

  getEntitlement(businessId: string): Promise<Entitlement | null> {
    const row = this.rows.get(businessId);
    if (!row) return Promise.resolve(null);

    return Promise.resolve({
      mode: row.mode,
      freeGenerationsUsed: row.used,
      freeGenerationLimit: row.limit,
      fairUseMonthlySoftLimit: row.softLimit,
    });
  }

  async tryConsume(businessId: string): Promise<number | null> {
    const row = this.rows.get(businessId);
    if (!row) return null;

    if (this.racy) {
      // The broken implementation: observe, yield, then write back.
      const observed = row.used;
      await Promise.resolve();
      if (observed >= row.limit) return null;
      row.used = observed + 1;
      return row.used;
    }

    // The correct implementation: guard and increment with no suspension point between them,
    // which is what the single SQL statement buys in Postgres.
    if (row.used >= row.limit) return null;
    row.used += 1;
    return row.used;
  }

  release(businessId: string): Promise<void> {
    const row = this.rows.get(businessId);
    if (row && row.used > 0) row.used -= 1;
    return Promise.resolve();
  }

  usage(businessId: string): number {
    return this.rows.get(businessId)?.used ?? 0;
  }
}

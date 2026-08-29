import { and, eq, sql } from 'drizzle-orm';
import { businesses, subscriptions, type Database } from '@ai-review/db';
import type { Entitlement, QuotaStore } from './types';

/**
 * Postgres-backed quota store.
 *
 * The correctness of AC-013 lives entirely in tryConsume below.
 */
export class PostgresQuotaStore implements QuotaStore {
  constructor(private readonly db: Database) {}

  async getEntitlement(businessId: string): Promise<Entitlement | null> {
    const [row] = await this.db
      .select({
        status: subscriptions.status,
        used: subscriptions.freeGenerationsUsed,
        limit: subscriptions.freeGenerationLimit,
        softLimit: subscriptions.fairUseMonthlySoftLimit,
        expiresAt: subscriptions.expiresAt,
        businessStatus: businesses.status,
      })
      .from(subscriptions)
      .innerJoin(businesses, eq(businesses.id, subscriptions.businessId))
      .where(eq(subscriptions.businessId, businessId))
      .limit(1);

    if (!row) return null;

    return {
      mode: resolveMode(row.businessStatus, row.status, row.expiresAt),
      freeGenerationsUsed: row.used,
      freeGenerationLimit: row.limit,
      fairUseMonthlySoftLimit: row.softLimit,
    };
  }

  /**
   * One statement. The guard and the increment happen inside a single row lock, so a
   * concurrent eleventh request finds used = limit and matches no row.
   *
   * This must never be split into a SELECT then an UPDATE. With a read-modify-write, ten
   * concurrent requests all read 9 and all write 10, and the business receives nineteen free
   * generations — which is exactly the bypass AC-013 tests for.
   */
  async tryConsume(businessId: string): Promise<number | null> {
    const rows = await this.db
      .update(subscriptions)
      .set({
        freeGenerationsUsed: sql`${subscriptions.freeGenerationsUsed} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(subscriptions.businessId, businessId),
          sql`${subscriptions.freeGenerationsUsed} < ${subscriptions.freeGenerationLimit}`,
        ),
      )
      .returning({ used: subscriptions.freeGenerationsUsed });

    return rows[0]?.used ?? null;
  }

  /**
   * AC-014. Guarded at zero so a double release can never drive the counter negative — the
   * ck_free_used_non_negative constraint would otherwise abort the transaction.
   */
  async release(businessId: string): Promise<void> {
    await this.db
      .update(subscriptions)
      .set({
        freeGenerationsUsed: sql`${subscriptions.freeGenerationsUsed} - 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(subscriptions.businessId, businessId),
          sql`${subscriptions.freeGenerationsUsed} > 0`,
        ),
      );
  }
}

function resolveMode(
  businessStatus: string,
  subscriptionStatus: string,
  expiresAt: Date | null,
): Entitlement['mode'] {
  // A suspended tenant generates nothing, whatever it has paid (Flow J, ADMIN-02).
  if (businessStatus !== 'ACTIVE') return 'BLOCKED';

  if (subscriptionStatus === 'PRO_ACTIVE') {
    const stillValid = !expiresAt || expiresAt.getTime() > Date.now();
    // An expired Pro plan falls back to whatever free quota remains (Flow J), rather than
    // being blocked outright — the direct Google button must keep working regardless.
    return stillValid ? 'PRO' : 'FREE';
  }

  if (subscriptionStatus === 'CANCELLED') return 'FREE';

  return 'FREE';
}

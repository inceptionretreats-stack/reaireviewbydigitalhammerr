import { and, eq, sql } from 'drizzle-orm';
import { businesses, subscriptions, type Database } from '@ai-review/db';
import type { Entitlement, QuotaConsumption, QuotaReservation, QuotaStore } from './types';

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
        proUsed: subscriptions.proGenerationsUsed,
        proLimit: subscriptions.proGenerationLimit,
        softLimit: subscriptions.fairUseMonthlySoftLimit,
        startsAt: subscriptions.startsAt,
        expiresAt: subscriptions.expiresAt,
        businessStatus: businesses.status,
      })
      .from(subscriptions)
      .innerJoin(businesses, eq(businesses.id, subscriptions.businessId))
      .where(eq(subscriptions.businessId, businessId))
      .limit(1);

    if (!row) return null;

    return {
      mode: resolveMode(row.businessStatus, row.status, row.startsAt, row.expiresAt),
      freeGenerationsUsed: row.used,
      freeGenerationLimit: row.limit,
      proGenerationsUsed: row.proUsed,
      proGenerationLimit: row.proLimit,
      periodStartsAt: row.startsAt,
      periodEndsAt: row.expiresAt,
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
  async tryConsume(
    businessId: string,
    mode: QuotaReservation['mode'],
  ): Promise<QuotaConsumption | null> {
    const now = new Date();

    if (mode === 'PRO') {
      const rows = await this.db
        .update(subscriptions)
        .set({
          proGenerationsUsed: sql`${subscriptions.proGenerationsUsed} + 1`,
          updatedAt: now,
        })
        .where(
          and(
            eq(subscriptions.businessId, businessId),
            sql`${subscriptions.status} IN ('PRO_ACTIVE', 'PAST_DUE')`,
            sql`${subscriptions.startsAt} <= ${now}`,
            sql`${subscriptions.expiresAt} > ${now}`,
            sql`${subscriptions.proGenerationsUsed} < ${subscriptions.proGenerationLimit}`,
            activeBusinessGuard(),
          ),
        )
        .returning({
          used: subscriptions.proGenerationsUsed,
          periodStartsAt: subscriptions.startsAt,
        });

      const consumed = rows[0];
      return consumed
        ? { usedAfterReserve: consumed.used, periodStartsAt: consumed.periodStartsAt }
        : null;
    }

    const rows = await this.db
      .update(subscriptions)
      .set({
        freeGenerationsUsed: sql`${subscriptions.freeGenerationsUsed} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(subscriptions.businessId, businessId),
          sql`${subscriptions.freeGenerationsUsed} < ${subscriptions.freeGenerationLimit}`,
          sql`NOT (
            ${subscriptions.status} IN ('PRO_ACTIVE', 'PAST_DUE')
            AND ${subscriptions.startsAt} IS NOT NULL
            AND ${subscriptions.expiresAt} IS NOT NULL
            AND ${subscriptions.startsAt} <= ${now}
            AND ${subscriptions.expiresAt} > ${now}
          )`,
          activeBusinessGuard(),
        ),
      )
      .returning({ used: subscriptions.freeGenerationsUsed });

    const consumed = rows[0];
    return consumed ? { usedAfterReserve: consumed.used, periodStartsAt: null } : null;
  }

  /**
   * AC-014. Guarded at zero so a double release can never drive the counter negative — the
   * ck_free_used_non_negative constraint would otherwise abort the transaction.
   */
  async release(reservation: QuotaReservation): Promise<void> {
    if (reservation.mode === 'PRO') {
      if (!reservation.periodStartsAt) return;

      await this.db
        .update(subscriptions)
        .set({
          proGenerationsUsed: sql`${subscriptions.proGenerationsUsed} - 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(subscriptions.businessId, reservation.businessId),
            sql`date_trunc('milliseconds', ${subscriptions.startsAt}) = ${reservation.periodStartsAt}`,
            sql`${subscriptions.proGenerationsUsed} > 0`,
          ),
        );
      return;
    }

    await this.db
      .update(subscriptions)
      .set({
        freeGenerationsUsed: sql`${subscriptions.freeGenerationsUsed} - 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(subscriptions.businessId, reservation.businessId),
          sql`${subscriptions.freeGenerationsUsed} > 0`,
        ),
      );
  }
}

function resolveMode(
  businessStatus: string,
  subscriptionStatus: string,
  startsAt: Date | null,
  expiresAt: Date | null,
): Entitlement['mode'] {
  // A suspended tenant generates nothing, whatever it has paid (Flow J, ADMIN-02).
  if (businessStatus !== 'ACTIVE') return 'BLOCKED';

  if (subscriptionStatus === 'PRO_ACTIVE' || subscriptionStatus === 'PAST_DUE') {
    const now = Date.now();
    const stillValid =
      startsAt !== null &&
      expiresAt !== null &&
      startsAt.getTime() <= now &&
      expiresAt.getTime() > now;
    // An expired Pro plan falls back to whatever free quota remains (Flow J), rather than
    // being blocked outright — the direct Google button must keep working regardless.
    return stillValid ? 'PRO' : 'FREE';
  }

  if (subscriptionStatus === 'CANCELLED') return 'FREE';

  return 'FREE';
}

/** Prevents a stale entitlement read from granting a generation after an admin suspension. */
function activeBusinessGuard() {
  return sql`EXISTS (
    SELECT 1 FROM ${businesses}
    WHERE ${businesses.id} = ${subscriptions.businessId}
      AND ${businesses.status} = 'ACTIVE'
  )`;
}

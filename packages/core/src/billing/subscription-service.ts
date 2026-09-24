import { eq } from 'drizzle-orm';
import { businesses, subscriptions, type Subscription } from '@ai-review/db';
import { auditActorType, type AdminAction } from '../audit/actor';
import { AuditWriter } from '../audit/writer';
import type { Executor } from '../db-executor';

/**
 * Every write to a business's entitlement goes through here (E10-04, E12-04, Flow E, Flow J).
 *
 * Until this existed, the only way a business ever became Pro was an operator typing an UPDATE
 * into psql — unaudited, with no reason, and indistinguishable afterwards from a paid year.
 * The spec has two sanctioned mechanisms and both land on the same primitive: a verified
 * Razorpay payment (`source: 'PAYMENT'`) and a super-admin grant with a reason
 * (`source: 'ADMIN'`). One code path, so the invariants hold for both: a paid status always
 * carries a period (ck_paid_status_has_period), a new period resets the annual counter
 * (migration 0003's trigger), and the row remembers how it got here (entitlement_source) —
 * which is what lets the dashboard show a manual grant differently from a paid one, as
 * 19_Admin_Panel_Spec requires.
 *
 * Admin actions are written inside the same transaction as the mutation, with before/after
 * state, through the AuditWriter that enforces the reason rule (RBAC rule 5). A payment
 * activation has no admin actor and is not an admin mutation; the route records it as the
 * `subscription_activated` analytics event instead.
 */

export interface ActivateByAdmin extends AdminAction {
  source: 'ADMIN';
  /** Whole months of Pro from now (or from `startsAt`). Default one year. */
  months?: number;
  startsAt?: Date;
  note?: string | null;
}

export interface ActivateByPayment {
  source: 'PAYMENT';
  months?: number;
  startsAt?: Date;
  /** The payments.id that earned this period; stored on the note for the audit trail. */
  paymentId: string;
}

export type ActivateProInput = ActivateByAdmin | ActivateByPayment;

export class SubscriptionNotFoundError extends Error {
  constructor(businessId: string) {
    super(`No subscription row for business ${businessId}`);
    this.name = 'SubscriptionNotFoundError';
  }
}

export class InvalidQuotaAdjustmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidQuotaAdjustmentError';
  }
}

export class SubscriptionService {
  /** A pool or a transaction: inside another service's transaction the writes join it as a savepoint. */
  constructor(private readonly db: Executor) {}

  async get(businessId: string): Promise<Subscription | null> {
    const [row] = await this.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.businessId, businessId))
      .limit(1);
    return row ?? null;
  }

  /**
   * Puts a business on Pro for a period.
   *
   * If the business is already inside a paid period, the new period starts where the current
   * one ends — a renewal, whether paid early or granted early, never throws away time already
   * owned. Otherwise it starts now. Either way `starts_at` changes, and the database trigger
   * from migration 0003 resets the annual counter for the new year.
   */
  async activatePro(businessId: string, input: ActivateProInput): Promise<Subscription> {
    const months = input.months ?? 12;
    if (!Number.isInteger(months) || months < 1 || months > 60) {
      throw new InvalidQuotaAdjustmentError('months must be a whole number from 1 to 60');
    }

    return this.db.transaction(async (tx) => {
      const before = await readSubscription(tx, businessId);
      if (!before) throw new SubscriptionNotFoundError(businessId);

      const now = new Date();
      const currentlyPaid =
        (before.status === 'PRO_ACTIVE' || before.status === 'PAST_DUE') &&
        before.expiresAt !== null &&
        before.expiresAt.getTime() > now.getTime();
      const startsAt = input.startsAt ?? (currentlyPaid ? before.expiresAt! : now);
      const expiresAt = addMonths(startsAt, months);

      const [after] = await tx
        .update(subscriptions)
        .set({
          status: 'PRO_ACTIVE',
          startsAt,
          expiresAt,
          entitlementSource: input.source,
          entitlementGrantedBy: input.source === 'ADMIN' ? input.actor.userId : null,
          entitlementNote:
            input.source === 'ADMIN' ? input.note?.trim() || null : `payment:${input.paymentId}`,
          updatedAt: now,
        })
        .where(eq(subscriptions.businessId, businessId))
        .returning();

      if (input.source === 'ADMIN') {
        await new AuditWriter(tx).record({
          actorUserId: input.actor.userId,
          actorType: auditActorType(input.actor),
          ipHash: input.actor.ipHash ?? null,
          businessId,
          action: 'business.entitlement.adjust',
          targetType: 'subscription',
          targetId: before.id,
          reason: input.reason,
          before: auditView(before),
          after: auditView(after!),
        });
      }
      return after!;
    });
  }

  /**
   * Takes Pro away. The row becomes CANCELLED — not FREE — so the history of having paid stays
   * readable, and the quota engine already treats CANCELLED as "whatever free allowance is
   * left" (Flow J). The dates are kept for the same reason.
   */
  async revokePro(businessId: string, input: AdminAction): Promise<Subscription> {
    return this.audited(businessId, input, 'business.entitlement.adjust', (tx, before) =>
      tx
        .update(subscriptions)
        .set({
          status: before.status === 'FREE' ? 'FREE' : 'CANCELLED',
          entitlementSource: 'NONE',
          entitlementGrantedBy: null,
          entitlementNote: null,
          updatedAt: new Date(),
        })
        .where(eq(subscriptions.businessId, businessId))
        .returning(),
    );
  }

  /** Changes the lifetime free allowance. Never below what is already used (the check constraint). */
  async adjustFreeQuota(
    businessId: string,
    input: AdminAction & { freeGenerationLimit: number },
  ): Promise<Subscription> {
    const limit = input.freeGenerationLimit;
    if (!Number.isInteger(limit) || limit < 0 || limit > 100_000) {
      throw new InvalidQuotaAdjustmentError('free limit must be a whole number from 0 to 100000');
    }
    return this.audited(businessId, input, 'business.quota.reset', (tx, before) => {
      if (limit < before.freeGenerationsUsed) {
        throw new InvalidQuotaAdjustmentError(
          `free limit ${limit} is below the ${before.freeGenerationsUsed} already used; reset usage first`,
        );
      }
      return tx
        .update(subscriptions)
        .set({ freeGenerationLimit: limit, updatedAt: new Date() })
        .where(eq(subscriptions.businessId, businessId))
        .returning();
    });
  }

  /** Puts the lifetime free counter back to zero. */
  async resetFreeUsage(businessId: string, input: AdminAction): Promise<Subscription> {
    return this.audited(businessId, input, 'business.quota.reset', (tx) =>
      tx
        .update(subscriptions)
        .set({ freeGenerationsUsed: 0, updatedAt: new Date() })
        .where(eq(subscriptions.businessId, businessId))
        .returning(),
    );
  }

  /**
   * Suspend / reactivate live on the business row, not the subscription, but they are
   * entitlement decisions in effect: a suspended tenant generates nothing whatever it has paid
   * (Flow J), so they belong with the other audited switches.
   */
  async suspend(businessId: string, input: AdminAction): Promise<void> {
    await this.setBusinessStatus(businessId, 'SUSPENDED', 'business.suspend', input);
  }

  async reactivate(businessId: string, input: AdminAction): Promise<void> {
    await this.setBusinessStatus(businessId, 'ACTIVE', 'business.reactivate', input);
  }

  private async setBusinessStatus(
    businessId: string,
    status: 'ACTIVE' | 'SUSPENDED',
    action: 'business.suspend' | 'business.reactivate',
    input: AdminAction,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const read = async () => {
        const [row] = await tx
          .select({ status: businesses.status })
          .from(businesses)
          .where(eq(businesses.id, businessId))
          .limit(1);
        return row ?? null;
      };
      const before = await read();
      if (!before) throw new SubscriptionNotFoundError(businessId);
      await tx
        .update(businesses)
        .set({ status, updatedAt: new Date() })
        .where(eq(businesses.id, businessId));
      await new AuditWriter(tx).record({
        actorUserId: input.actor.userId,
        actorType: auditActorType(input.actor),
        ipHash: input.actor.ipHash ?? null,
        businessId,
        action,
        targetType: 'business',
        targetId: businessId,
        reason: input.reason,
        before,
        after: await read(),
      });
    });
  }

  private async audited(
    businessId: string,
    input: AdminAction,
    action: string,
    mutate: (tx: Executor, before: Subscription) => Promise<Subscription[]>,
  ): Promise<Subscription> {
    return this.db.transaction(async (tx) => {
      const before = await readSubscription(tx, businessId);
      if (!before) throw new SubscriptionNotFoundError(businessId);
      const [after] = await mutate(tx, before);
      await new AuditWriter(tx).record({
        actorUserId: input.actor.userId,
        actorType: auditActorType(input.actor),
        ipHash: input.actor.ipHash ?? null,
        businessId,
        action,
        targetType: 'subscription',
        targetId: before.id,
        reason: input.reason,
        before: auditView(before),
        after: auditView(after!),
      });
      return after!;
    });
  }
}

async function readSubscription(tx: Executor, businessId: string): Promise<Subscription | null> {
  const [row] = await tx
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.businessId, businessId))
    // Serialises two admins (or an admin and a webhook) acting on the same row.
    .for('update')
    .limit(1);
  return row ?? null;
}

/** The fields worth keeping in an audit row; timestamps and ids that never change are noise. */
function auditView(row: Subscription) {
  return {
    status: row.status,
    starts_at: row.startsAt,
    expires_at: row.expiresAt,
    free_generation_limit: row.freeGenerationLimit,
    free_generations_used: row.freeGenerationsUsed,
    pro_generation_limit: row.proGenerationLimit,
    pro_generations_used: row.proGenerationsUsed,
    entitlement_source: row.entitlementSource,
    entitlement_note: row.entitlementNote,
  };
}

/** Calendar months, clamped to the last day of a shorter month (31 Jan + 1 → 28/29 Feb). */
export function addMonths(from: Date, months: number): Date {
  const result = new Date(from.getTime());
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const daysInTarget = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(day, daysInTarget));
  return result;
}

/** True while a paid period covers `at`. Mirrors the quota store's resolveMode. */
export function isPaidNow(
  row: Pick<Subscription, 'status' | 'startsAt' | 'expiresAt'>,
  at = new Date(),
) {
  return (
    (row.status === 'PRO_ACTIVE' || row.status === 'PAST_DUE') &&
    row.startsAt !== null &&
    row.expiresAt !== null &&
    row.startsAt.getTime() <= at.getTime() &&
    row.expiresAt.getTime() > at.getTime()
  );
}

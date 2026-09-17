import { and, desc, eq, gt, inArray, sql, type SQL } from 'drizzle-orm';
import {
  adminAuditLogs,
  businesses,
  paymentRefunds,
  payments,
  paymentWebhookEvents,
  subscriptions,
  users,
  type Database,
  type Payment,
  type PaymentRefund,
} from '@ai-review/db';
import { AuditWriter } from '../audit/writer';
import type { Executor } from '../db-executor';
import { CheckoutService } from './checkout-service';
import { RazorpayError, type RazorpayClient } from './razorpay';
import {
  auditActorType,
  SubscriptionService,
  SYSTEM_ACTOR,
  type AdminActor,
} from './subscription-service';

/**
 * Payment control for the platform admin (AMENDMENT-029): the cross-tenant list, the webhook
 * ledger, one payment in full, and the four things an admin can do to a payment.
 *
 * Refunds run in three phases because the money moves at Razorpay, not here. A REQUESTED row
 * is written first, so a crash after the API call leaves a trace to reconcile against rather
 * than a refund nobody recorded; then Razorpay is asked; then the row and the payment are
 * updated with what it said. A refund is idempotent by `provider_refund_id`, which is how a
 * `refund.processed` webhook for a refund this service started is a no-op rather than a second
 * deduction.
 *
 * Policy: a partial refund never touches the entitlement. A full refund revokes Pro only when
 * that payment funded the current period (`subscriptions.entitlement_note = 'payment:<id>'`) —
 * refunding last year's payment does not take away this year's.
 */

export type PaymentAdminErrorCode =
  'NOT_FOUND' | 'STATE_INVALID' | 'AMOUNT_INVALID' | 'REFUND_FAILED' | 'NOT_CONFIGURED';

export class PaymentAdminError extends Error {
  constructor(
    readonly code: PaymentAdminErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PaymentAdminError';
  }
}

export interface PaymentListFilter {
  status?: Payment['status'];
  businessId?: string;
  from?: Date;
  to?: Date;
  refunded?: boolean;
  /** Keyset: rows created before this payment. */
  beforeId?: string;
  limit?: number;
}

export interface PaymentListRow {
  id: string;
  businessId: string;
  businessName: string;
  ownerEmail: string;
  status: Payment['status'];
  amountPaise: number;
  refundedPaise: number;
  currency: string;
  providerOrderId: string | null;
  providerPaymentId: string | null;
  invoiceNumber: string | null;
  failureReason: string | null;
  createdAt: Date;
  paidAt: Date | null;
  refundedAt: Date | null;
  receiptEmailedAt: Date | null;
  /** The most recent webhook that landed on this payment, if any. */
  lastWebhook: { eventType: string; outcome: string | null; at: Date } | null;
}

export interface WebhookLedgerRow {
  id: string;
  eventType: string;
  providerEventId: string | null;
  outcome: string | null;
  processingError: string | null;
  paymentId: string | null;
  businessId: string | null;
  businessName: string | null;
  createdAt: Date;
  processedAt: Date | null;
}

export interface PaymentDetail {
  payment: Payment;
  business: { id: string; name: string; status: string; timezone: string };
  owner: { id: string; email: string; fullName: string };
  subscription: { status: string; entitlementNote: string | null; expiresAt: Date | null } | null;
  /** Whether a full refund would revoke Pro — this payment funds the current period. */
  fundsCurrentPeriod: boolean;
  refunds: PaymentRefund[];
  webhooks: WebhookLedgerRow[];
  audit: Array<{
    id: number;
    action: string;
    actorEmail: string | null;
    actorType: string;
    reason: string | null;
    createdAt: Date;
  }>;
}

export interface RefundInput {
  actor: AdminActor;
  reason: string;
  /** Omit for a full refund of whatever is still refundable. */
  amountPaise?: number;
  client: RazorpayClient;
}

export interface RefundOutcome {
  refund: PaymentRefund;
  payment: Payment;
  /** True when the refund completed the amount and Pro was taken away. */
  revoked: boolean;
}

const DEFAULT_LIMIT = 50;

export class PaymentAdminService {
  constructor(private readonly db: Database) {}

  async list(
    filter: PaymentListFilter = {},
  ): Promise<{ rows: PaymentListRow[]; nextBefore: string | null }> {
    const limit = Math.min(Math.max(filter.limit ?? DEFAULT_LIMIT, 1), 200);
    const where: SQL[] = [];
    if (filter.status) where.push(eq(payments.status, filter.status));
    if (filter.businessId) where.push(eq(payments.businessId, filter.businessId));
    if (filter.from) where.push(sql`${payments.createdAt} >= ${filter.from}`);
    if (filter.to) where.push(sql`${payments.createdAt} < ${filter.to}`);
    if (filter.refunded === true) where.push(gt(payments.refundedPaise, 0));
    if (filter.refunded === false) where.push(eq(payments.refundedPaise, 0));
    if (filter.beforeId) {
      where.push(
        sql`(${payments.createdAt}, ${payments.id}) < (SELECT p.created_at, p.id FROM payments p WHERE p.id = ${filter.beforeId})`,
      );
    }

    const rows = await this.db
      .select({
        id: payments.id,
        businessId: payments.businessId,
        businessName: businesses.name,
        ownerEmail: users.email,
        status: payments.status,
        amountPaise: payments.amountPaise,
        refundedPaise: payments.refundedPaise,
        currency: payments.currency,
        providerOrderId: payments.providerOrderId,
        providerPaymentId: payments.providerPaymentId,
        invoiceNumber: payments.invoiceNumber,
        failureReason: payments.failureReason,
        createdAt: payments.createdAt,
        paidAt: payments.paidAt,
        refundedAt: payments.refundedAt,
        receiptEmailedAt: payments.receiptEmailedAt,
      })
      .from(payments)
      .innerJoin(businesses, eq(businesses.id, payments.businessId))
      .innerJoin(users, eq(users.id, businesses.ownerUserId))
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(payments.createdAt), desc(payments.id))
      .limit(limit + 1);

    const page = rows.slice(0, limit);
    const lastWebhooks = await this.lastWebhookFor(page.map((r) => r.id));
    return {
      rows: page.map((r) => ({ ...r, lastWebhook: lastWebhooks.get(r.id) ?? null })),
      nextBefore: rows.length > limit ? page[page.length - 1]!.id : null,
    };
  }

  async listWebhookEvents(
    filter: {
      outcome?: string;
      eventType?: string;
      beforeId?: string;
      limit?: number;
    } = {},
  ): Promise<{ rows: WebhookLedgerRow[]; nextBefore: string | null }> {
    const limit = Math.min(Math.max(filter.limit ?? DEFAULT_LIMIT, 1), 200);
    const where: SQL[] = [];
    if (filter.outcome) where.push(eq(paymentWebhookEvents.outcome, filter.outcome));
    if (filter.eventType) where.push(eq(paymentWebhookEvents.eventType, filter.eventType));
    if (filter.beforeId) {
      where.push(
        sql`(${paymentWebhookEvents.createdAt}, ${paymentWebhookEvents.id}) < (SELECT e.created_at, e.id FROM payment_webhook_events e WHERE e.id = ${filter.beforeId})`,
      );
    }
    const rows = await this.db
      .select({
        id: paymentWebhookEvents.id,
        eventType: paymentWebhookEvents.eventType,
        providerEventId: paymentWebhookEvents.providerEventId,
        outcome: paymentWebhookEvents.outcome,
        processingError: paymentWebhookEvents.processingError,
        paymentId: paymentWebhookEvents.paymentId,
        businessId: payments.businessId,
        businessName: businesses.name,
        createdAt: paymentWebhookEvents.createdAt,
        processedAt: paymentWebhookEvents.processedAt,
      })
      .from(paymentWebhookEvents)
      .leftJoin(payments, eq(payments.id, paymentWebhookEvents.paymentId))
      .leftJoin(businesses, eq(businesses.id, payments.businessId))
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(paymentWebhookEvents.createdAt), desc(paymentWebhookEvents.id))
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    return { rows: page, nextBefore: rows.length > limit ? page[page.length - 1]!.id : null };
  }

  async get(paymentId: string): Promise<PaymentDetail | null> {
    const [row] = await this.db
      .select({
        payment: payments,
        business: {
          id: businesses.id,
          name: businesses.name,
          status: businesses.status,
          timezone: businesses.timezone,
        },
        owner: { id: users.id, email: users.email, fullName: users.fullName },
      })
      .from(payments)
      .innerJoin(businesses, eq(businesses.id, payments.businessId))
      .innerJoin(users, eq(users.id, businesses.ownerUserId))
      .where(eq(payments.id, paymentId))
      .limit(1);
    if (!row) return null;

    const [subscription] = await this.db
      .select({
        status: subscriptions.status,
        entitlementNote: subscriptions.entitlementNote,
        expiresAt: subscriptions.expiresAt,
      })
      .from(subscriptions)
      .where(eq(subscriptions.businessId, row.payment.businessId))
      .limit(1);

    const [refunds, webhooks, audit] = await Promise.all([
      this.db
        .select()
        .from(paymentRefunds)
        .where(eq(paymentRefunds.paymentId, paymentId))
        .orderBy(desc(paymentRefunds.createdAt)),
      this.db
        .select({
          id: paymentWebhookEvents.id,
          eventType: paymentWebhookEvents.eventType,
          providerEventId: paymentWebhookEvents.providerEventId,
          outcome: paymentWebhookEvents.outcome,
          processingError: paymentWebhookEvents.processingError,
          paymentId: paymentWebhookEvents.paymentId,
          createdAt: paymentWebhookEvents.createdAt,
          processedAt: paymentWebhookEvents.processedAt,
        })
        .from(paymentWebhookEvents)
        .where(eq(paymentWebhookEvents.paymentId, paymentId))
        .orderBy(desc(paymentWebhookEvents.createdAt))
        .limit(50),
      this.db
        .select({
          id: adminAuditLogs.id,
          action: adminAuditLogs.action,
          actorEmail: users.email,
          actorType: adminAuditLogs.actorType,
          reason: adminAuditLogs.reason,
          createdAt: adminAuditLogs.createdAt,
        })
        .from(adminAuditLogs)
        .leftJoin(users, eq(users.id, adminAuditLogs.actorUserId))
        .where(
          and(eq(adminAuditLogs.targetType, 'payment'), eq(adminAuditLogs.targetId, paymentId)),
        )
        .orderBy(desc(adminAuditLogs.createdAt))
        .limit(50),
    ]);

    return {
      payment: row.payment,
      business: row.business,
      owner: row.owner,
      subscription: subscription ?? null,
      fundsCurrentPeriod: subscription?.entitlementNote === `payment:${paymentId}`,
      refunds,
      webhooks: webhooks.map((w) => ({
        ...w,
        businessId: row.payment.businessId,
        businessName: row.business.name,
      })),
      audit,
    };
  }

  /**
   * Refunds part or all of a captured payment through Razorpay. Concurrent refunds of the same
   * payment queue on the row lock and the second sees the first's amount, so two admins cannot
   * together refund more than was paid (and `ck_refund_within_amount` would refuse it anyway).
   */
  async refund(paymentId: string, input: RefundInput): Promise<RefundOutcome> {
    // Phase 1 — decide and record the request, under the payment's row lock.
    const planned = await this.db.transaction(async (tx) => {
      const payment = await lockPayment(tx, paymentId);
      if (payment.status !== 'CAPTURED') {
        throw new PaymentAdminError('STATE_INVALID', 'Only a captured payment can be refunded.');
      }
      if (!payment.providerPaymentId) {
        throw new PaymentAdminError('STATE_INVALID', 'This payment has no Razorpay payment id.');
      }
      const remaining = payment.amountPaise - payment.refundedPaise;
      const amount = input.amountPaise ?? remaining;
      if (!Number.isInteger(amount) || amount < 100 || amount > remaining) {
        throw new PaymentAdminError(
          'AMOUNT_INVALID',
          `The refund must be between ₹1 and the ${remaining} paise still refundable.`,
        );
      }
      const [pending] = await tx
        .select({ id: paymentRefunds.id })
        .from(paymentRefunds)
        .where(
          and(
            eq(paymentRefunds.paymentId, paymentId),
            inArray(paymentRefunds.status, ['REQUESTED', 'PENDING']),
          ),
        )
        .limit(1);
      if (pending) {
        throw new PaymentAdminError(
          'STATE_INVALID',
          'A refund is already in progress for this payment. Wait for Razorpay to settle it.',
        );
      }
      const [row] = await tx
        .insert(paymentRefunds)
        .values({
          paymentId,
          amountPaise: amount,
          status: 'REQUESTED',
          reason: input.reason,
          requestedBy: input.actor.userId,
        })
        .returning();
      return { payment, refund: row!, amount, full: amount === remaining };
    });

    // Phase 2 — ask Razorpay. Nothing is locked while the network call runs.
    let provider;
    try {
      provider = await input.client.refund(planned.payment.providerPaymentId!, {
        ...(planned.full ? {} : { amountPaise: planned.amount }),
        receipt: planned.refund.id,
        notes: { payment_id: paymentId, refund_id: planned.refund.id },
      });
    } catch (error) {
      const message =
        error instanceof RazorpayError ? `${error.code}: ${error.message}` : String(error);
      await this.db
        .update(paymentRefunds)
        .set({ status: 'FAILED', error: message.slice(0, 500), processedAt: new Date() })
        .where(eq(paymentRefunds.id, planned.refund.id));
      throw new PaymentAdminError('REFUND_FAILED', 'Razorpay did not accept the refund.');
    }

    // Phase 3 — record what Razorpay said, move the money on our side, audit. The amount is
    // the one decided under the lock; Razorpay's echo is kept beside it for reconciliation.
    return this.applyRefund({
      paymentId,
      refundId: planned.refund.id,
      providerRefundId: provider.id,
      amountPaise: planned.amount,
      providerStatus: provider.status,
      actor: input.actor,
      reason: input.reason,
      raw: {
        source: 'admin',
        provider_status: provider.status,
        provider_amount_paise: provider.amountPaise,
      },
    });
  }

  /**
   * A refund Razorpay tells us about — one this service started (matched by id, a no-op past
   * marking it processed) or one made from the Razorpay dashboard (recorded as SYSTEM).
   */
  async applyProviderRefund(input: {
    providerPaymentId: string;
    providerRefundId: string;
    amountPaise: number;
    providerStatus: string;
    eventId: string;
  }): Promise<{ paymentId: string; applied: boolean } | null> {
    const [payment] = await this.db
      .select({ id: payments.id })
      .from(payments)
      .where(eq(payments.providerPaymentId, input.providerPaymentId))
      .limit(1);
    if (!payment) return null;
    const [known] = await this.db
      .select()
      .from(paymentRefunds)
      .where(eq(paymentRefunds.providerRefundId, input.providerRefundId))
      .limit(1);

    if (known && (known.status === 'PROCESSED' || known.status === 'FAILED')) {
      return { paymentId: payment.id, applied: false };
    }
    if (known) {
      // Ours, still pending: only its status moves; the money was counted when we requested it.
      const status = statusFrom(input.providerStatus);
      await this.db
        .update(paymentRefunds)
        .set({
          status,
          processedAt: status === 'PENDING' ? null : new Date(),
          rawReference: sql`${paymentRefunds.rawReference} || ${JSON.stringify({ webhook_event_id: input.eventId, provider_status: input.providerStatus })}::jsonb`,
        })
        .where(eq(paymentRefunds.id, known.id));
      if (status === 'FAILED') await this.reverseRefund(payment.id, known.id, known.amountPaise);
      return { paymentId: payment.id, applied: true };
    }
    if (statusFrom(input.providerStatus) === 'FAILED') {
      return { paymentId: payment.id, applied: false };
    }
    // One of ours between phases 2 and 3 — Razorpay answered the API call and fired the webhook
    // before the row was stamped with its id. Phase 3 will finish it; counting it here too would
    // deduct the amount twice.
    const [inFlight] = await this.db
      .select({ id: paymentRefunds.id })
      .from(paymentRefunds)
      .where(
        and(
          eq(paymentRefunds.paymentId, payment.id),
          eq(paymentRefunds.status, 'REQUESTED'),
          eq(paymentRefunds.amountPaise, input.amountPaise),
        ),
      )
      .limit(1);
    if (inFlight) return { paymentId: payment.id, applied: false };

    const [row] = await this.db
      .insert(paymentRefunds)
      .values({
        paymentId: payment.id,
        amountPaise: input.amountPaise,
        status: 'REQUESTED',
        reason: 'Refund made at Razorpay',
        requestedBy: null,
      })
      .returning();
    await this.applyRefund({
      paymentId: payment.id,
      refundId: row!.id,
      providerRefundId: input.providerRefundId,
      amountPaise: input.amountPaise,
      providerStatus: input.providerStatus,
      actor: SYSTEM_ACTOR,
      reason: 'Refund made at Razorpay (webhook)',
      raw: { source: 'webhook', webhook_event_id: input.eventId },
    });
    return { paymentId: payment.id, applied: true };
  }

  /**
   * Razorpay captured a payment we never settled — the webhook was blocked, or the browser
   * closed before the callback. Lists the order's payments at Razorpay and settles a captured
   * one through the same path checkout uses, so the invoice and activation are identical.
   */
  async reconcile(
    paymentId: string,
    input: { actor: AdminActor; reason: string; client: RazorpayClient },
  ): Promise<{ payment: Payment; activated: boolean; providerStatus: string }> {
    const [payment] = await this.db
      .select()
      .from(payments)
      .where(eq(payments.id, paymentId))
      .limit(1);
    if (!payment) throw new PaymentAdminError('NOT_FOUND', 'No such payment.');
    if (payment.status === 'CAPTURED' || payment.status === 'REFUNDED') {
      throw new PaymentAdminError('STATE_INVALID', 'This payment is already settled.');
    }
    if (!payment.providerOrderId) {
      throw new PaymentAdminError('STATE_INVALID', 'This payment has no Razorpay order to check.');
    }
    const attempts = await input.client.listOrderPayments(payment.providerOrderId);
    const captured = attempts.find((a) => a.status === 'captured');
    if (!captured) {
      await this.db.transaction(async (tx) => {
        await new AuditWriter(tx).record({
          actorUserId: input.actor.userId,
          actorType: auditActorType(input.actor),
          ipHash: input.actor.ipHash ?? null,
          businessId: payment.businessId,
          action: 'payment.reconcile',
          targetType: 'payment',
          targetId: paymentId,
          reason: input.reason,
          before: { status: payment.status },
          after: {
            status: payment.status,
            razorpay_attempts: attempts.map((a) => ({ id: a.id, status: a.status })),
          },
        });
      });
      const last = attempts[attempts.length - 1];
      return { payment, activated: false, providerStatus: last?.status ?? 'no attempts' };
    }
    const settled = await new CheckoutService(this.db).settleOrder({
      orderId: payment.providerOrderId,
      providerPaymentId: captured.id,
      expectedBusinessId: payment.businessId,
      amountPaise: captured.amountPaise,
      reference: { source: 'admin_reconcile', razorpay_payment_status: captured.status },
    });
    await this.db.transaction(async (tx) => {
      await new AuditWriter(tx).record({
        actorUserId: input.actor.userId,
        actorType: auditActorType(input.actor),
        ipHash: input.actor.ipHash ?? null,
        businessId: payment.businessId,
        action: 'payment.reconcile',
        targetType: 'payment',
        targetId: paymentId,
        reason: input.reason,
        before: { status: payment.status },
        after: {
          status: settled.payment.status,
          provider_payment_id: captured.id,
          activated: settled.activated,
        },
      });
    });
    return { payment: settled.payment, activated: settled.activated, providerStatus: 'captured' };
  }

  /** An abandoned checkout, closed by hand so the list stops showing it as open. */
  async markFailed(
    paymentId: string,
    input: { actor: AdminActor; reason: string },
  ): Promise<Payment> {
    return this.db.transaction(async (tx) => {
      const payment = await lockPayment(tx, paymentId);
      if (payment.status !== 'CREATED' && payment.status !== 'AUTHORIZED') {
        throw new PaymentAdminError(
          'STATE_INVALID',
          'Only a started or authorised payment can be marked failed.',
        );
      }
      const [after] = await tx
        .update(payments)
        .set({
          status: 'FAILED',
          failureReason: `Marked failed by admin: ${input.reason}`.slice(0, 500),
          updatedAt: new Date(),
        })
        .where(eq(payments.id, paymentId))
        .returning();
      await new AuditWriter(tx).record({
        actorUserId: input.actor.userId,
        actorType: auditActorType(input.actor),
        ipHash: input.actor.ipHash ?? null,
        businessId: payment.businessId,
        action: 'payment.mark_failed',
        targetType: 'payment',
        targetId: paymentId,
        reason: input.reason,
        before: { status: payment.status },
        after: { status: 'FAILED' },
      });
      return after!;
    });
  }

  /** Records that the receipt email went out (or was attempted) for a payment. */
  async markReceiptEmailed(paymentId: string, at = new Date()): Promise<void> {
    await this.db
      .update(payments)
      .set({ receiptEmailedAt: at, updatedAt: at })
      .where(eq(payments.id, paymentId));
  }

  private async applyRefund(input: {
    paymentId: string;
    refundId: string;
    providerRefundId: string;
    amountPaise: number;
    providerStatus: string;
    actor: AdminActor;
    reason: string;
    raw: Record<string, unknown>;
  }): Promise<RefundOutcome> {
    return this.db.transaction(async (tx) => {
      const payment = await lockPayment(tx, input.paymentId);
      const status = statusFrom(input.providerStatus);
      const [refund] = await tx
        .update(paymentRefunds)
        .set({
          providerRefundId: input.providerRefundId,
          status,
          processedAt: status === 'PENDING' ? null : new Date(),
          rawReference: input.raw,
        })
        .where(eq(paymentRefunds.id, input.refundId))
        .returning();

      const refundedPaise = payment.refundedPaise + input.amountPaise;
      const full = refundedPaise >= payment.amountPaise;
      const [after] = await tx
        .update(payments)
        .set({
          refundedPaise,
          refundedAt: new Date(),
          status: full ? 'REFUNDED' : payment.status,
          updatedAt: new Date(),
        })
        .where(eq(payments.id, payment.id))
        .returning();

      let revoked = false;
      if (full) {
        const [subscription] = await tx
          .select({ entitlementNote: subscriptions.entitlementNote, status: subscriptions.status })
          .from(subscriptions)
          .where(eq(subscriptions.businessId, payment.businessId))
          .limit(1);
        if (
          subscription?.entitlementNote === `payment:${payment.id}` &&
          subscription.status !== 'CANCELLED'
        ) {
          await new SubscriptionService(tx).revokePro(payment.businessId, {
            actor: input.actor,
            reason: `Full refund of payment ${payment.id}: ${input.reason}`,
          });
          revoked = true;
        }
      }

      await new AuditWriter(tx).record({
        actorUserId: input.actor.userId,
        actorType: auditActorType(input.actor),
        ipHash: input.actor.ipHash ?? null,
        businessId: payment.businessId,
        action: 'payment.refund',
        targetType: 'payment',
        targetId: payment.id,
        reason: input.reason,
        before: { status: payment.status, refunded_paise: payment.refundedPaise },
        after: {
          status: after!.status,
          refunded_paise: refundedPaise,
          refund_id: refund!.id,
          provider_refund_id: input.providerRefundId,
          provider_status: input.providerStatus,
          revoked,
        },
      });
      return { refund: refund!, payment: after!, revoked };
    });
  }

  /** A refund Razorpay later failed: the money never left, so the running total comes back. */
  private async reverseRefund(paymentId: string, refundId: string, amountPaise: number) {
    await this.db.transaction(async (tx) => {
      const payment = await lockPayment(tx, paymentId);
      const refundedPaise = Math.max(0, payment.refundedPaise - amountPaise);
      await tx
        .update(payments)
        .set({
          refundedPaise,
          status: payment.status === 'REFUNDED' ? 'CAPTURED' : payment.status,
          updatedAt: new Date(),
        })
        .where(eq(payments.id, paymentId));
      await new AuditWriter(tx).record({
        actorUserId: null,
        actorType: 'SYSTEM',
        ipHash: null,
        businessId: payment.businessId,
        action: 'payment.refund',
        targetType: 'payment',
        targetId: paymentId,
        reason: `Razorpay reported refund ${refundId} failed; amount restored`,
        before: { refunded_paise: payment.refundedPaise, status: payment.status },
        after: { refunded_paise: refundedPaise },
      });
    });
  }

  private async lastWebhookFor(paymentIds: string[]) {
    const map = new Map<string, { eventType: string; outcome: string | null; at: Date }>();
    if (paymentIds.length === 0) return map;
    const rows = await this.db
      .select({
        paymentId: paymentWebhookEvents.paymentId,
        eventType: paymentWebhookEvents.eventType,
        outcome: paymentWebhookEvents.outcome,
        at: paymentWebhookEvents.createdAt,
      })
      .from(paymentWebhookEvents)
      .where(inArray(paymentWebhookEvents.paymentId, paymentIds))
      .orderBy(desc(paymentWebhookEvents.createdAt));
    for (const row of rows) {
      if (row.paymentId && !map.has(row.paymentId)) {
        map.set(row.paymentId, { eventType: row.eventType, outcome: row.outcome, at: row.at });
      }
    }
    return map;
  }
}

async function lockPayment(tx: Executor, paymentId: string): Promise<Payment> {
  const [payment] = await tx
    .select()
    .from(payments)
    .where(eq(payments.id, paymentId))
    .for('update')
    .limit(1);
  if (!payment) throw new PaymentAdminError('NOT_FOUND', 'No such payment.');
  return payment;
}

function statusFrom(providerStatus: string): 'PENDING' | 'PROCESSED' | 'FAILED' {
  switch (providerStatus) {
    case 'processed':
      return 'PROCESSED';
    case 'failed':
      return 'FAILED';
    default:
      return 'PENDING';
  }
}

/** Counts for the overview card: open checkouts, failures and refunds over a window. */
export async function paymentOverview(
  db: Database,
  since: Date,
): Promise<{ open: number; failed: number; refunded: number; capturedPaise: number }> {
  const [row] = await db
    .select({
      open: sql<number>`count(*) filter (where ${payments.status} in ('CREATED', 'AUTHORIZED') and ${payments.createdAt} >= ${since})`,
      failed: sql<number>`count(*) filter (where ${payments.status} = 'FAILED' and ${payments.createdAt} >= ${since})`,
      refunded: sql<number>`count(*) filter (where ${payments.refundedPaise} > 0 and ${payments.refundedAt} >= ${since})`,
      capturedPaise: sql<number>`coalesce(sum(${payments.amountPaise}) filter (where ${payments.status} in ('CAPTURED', 'REFUNDED') and ${payments.paidAt} >= ${since}), 0)`,
    })
    .from(payments);
  return {
    open: Number(row?.open ?? 0),
    failed: Number(row?.failed ?? 0),
    refunded: Number(row?.refunded ?? 0),
    capturedPaise: Number(row?.capturedPaise ?? 0),
  };
}

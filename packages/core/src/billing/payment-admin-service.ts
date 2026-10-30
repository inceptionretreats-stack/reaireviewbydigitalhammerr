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
const REFUND_REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
      return { payment, refund: row!, amount };
    });

    // Phase 2 — ask Razorpay. Nothing is locked while the network call runs.
    let provider;
    try {
      provider = await input.client.refund(planned.payment.providerPaymentId!, {
        amountPaise: planned.amount,
        receipt: planned.refund.id,
        notes: { payment_id: paymentId, refund_id: planned.refund.id },
      });
    } catch (error) {
      const message =
        error instanceof RazorpayError ? `${error.code}: ${error.message}` : String(error);
      const definitiveRejection = error instanceof RazorpayError && error.code === 'REJECTED';
      const settled = await this.db.transaction(async (tx) => {
        const payment = await lockPayment(tx, paymentId);
        const [refund] = await tx
          .select()
          .from(paymentRefunds)
          .where(eq(paymentRefunds.id, planned.refund.id))
          .for('update')
          .limit(1);
        if (refund?.status === 'PENDING' || refund?.status === 'PROCESSED') {
          const reference = refund.rawReference as Record<string, unknown>;
          return {
            refund,
            payment,
            revoked: typeof reference?.['revocation_audit_id'] === 'number',
          };
        }
        // A timeout or upstream error may happen after Razorpay accepted the refund. Leave the
        // request open so a webhook bearing our receipt/notes can complete it exactly once.
        if (refund?.status === 'REQUESTED' && definitiveRejection) {
          await tx
            .update(paymentRefunds)
            .set({ status: 'FAILED', error: message.slice(0, 500), processedAt: new Date() })
            .where(eq(paymentRefunds.id, refund.id));
        }
        return null;
      });
      if (settled) return settled;
      throw new PaymentAdminError(
        'REFUND_FAILED',
        definitiveRejection
          ? 'Razorpay did not accept the refund.'
          : 'Razorpay did not confirm the refund. Check its status before trying again.',
      );
    }

    if (
      provider.paymentId !== planned.payment.providerPaymentId ||
      provider.amountPaise !== planned.amount
    ) {
      const settled = await this.db.transaction(async (tx) => {
        const payment = await lockPayment(tx, paymentId);
        const [refund] = await tx
          .select()
          .from(paymentRefunds)
          .where(eq(paymentRefunds.id, planned.refund.id))
          .for('update')
          .limit(1);
        if (!refund || refund.paymentId !== payment.id) {
          throw new PaymentAdminError('NOT_FOUND', 'No such refund request.');
        }
        if (refund.status === 'PENDING' || refund.status === 'PROCESSED') {
          const reference = refund.rawReference as Record<string, unknown>;
          return {
            refund,
            payment,
            revoked: typeof reference?.['revocation_audit_id'] === 'number',
          };
        }
        if (refund.status === 'REQUESTED') {
          await tx
            .update(paymentRefunds)
            .set({
              rawReference: sql`${paymentRefunds.rawReference} || ${JSON.stringify({
                provider_refund_id: provider.id,
                provider_payment_id: provider.paymentId,
                provider_amount_paise: provider.amountPaise,
                provider_status: provider.status,
                expected_payment_id: planned.payment.providerPaymentId,
                expected_amount_paise: planned.amount,
                reconciliation_required: true,
              })}::jsonb`,
            })
            .where(eq(paymentRefunds.id, refund.id));
        }
        return null;
      });
      if (settled) return settled;
      throw new PaymentAdminError(
        'REFUND_FAILED',
        `Razorpay refund ${provider.id} does not match the requested payment or amount. Check its status and reconcile it before trying again.`,
      );
    }

    // Phase 3 — record what Razorpay said, move the money on our side, audit. The amount is
    // the one decided under the lock; Razorpay's echo is kept beside it for reconciliation.
    const outcome = await this.applyRefund({
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
    if (outcome.refund.status === 'FAILED') {
      throw new PaymentAdminError('REFUND_FAILED', 'Razorpay reported the refund failed.');
    }
    return outcome;
  }

  /**
   * A refund Razorpay tells us about — one this service started (matched by id, a no-op past
   * marking it processed) or one made from the Razorpay dashboard (recorded as SYSTEM).
   */
  async applyProviderRefund(input: {
    providerPaymentId: string;
    providerRefundId: string;
    refundRequestId: string | null;
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

    if (known) {
      // Lock in the same order as refund()/applyRefund(). A duplicate failed webhook must not
      // reverse the amount twice, and the payment, refund and entitlement must move together.
      return this.db.transaction(async (tx) => {
        const lockedPayment = await lockPayment(tx, payment.id);
        const [refund] = await tx
          .select()
          .from(paymentRefunds)
          .where(eq(paymentRefunds.id, known.id))
          .for('update')
          .limit(1);
        if (!refund || refund.paymentId !== lockedPayment.id) return null;
        if (refund.amountPaise !== input.amountPaise) {
          throw new Error('Refund webhook amount does not match its local request.');
        }
        if (
          input.refundRequestId &&
          REFUND_REQUEST_ID.test(input.refundRequestId) &&
          input.refundRequestId !== refund.id
        ) {
          throw new Error('Refund webhook request id conflicts with its provider id.');
        }
        if (refund.status === 'PROCESSED' || refund.status === 'FAILED') {
          return { paymentId: lockedPayment.id, applied: false };
        }
        const status = statusFrom(input.providerStatus);
        // The receipt/notes carry our request id. With that exact match, the webhook can finish
        // even if the API process died before phase 3. The payment lock holds through accounting.
        if (
          refund.status === 'REQUESTED' &&
          input.refundRequestId === refund.id &&
          refund.amountPaise === input.amountPaise
        ) {
          await this.applyRefund(
            {
              paymentId: lockedPayment.id,
              refundId: refund.id,
              providerRefundId: input.providerRefundId,
              amountPaise: refund.amountPaise,
              providerStatus: input.providerStatus,
              actor: refund.requestedBy ? { userId: refund.requestedBy } : SYSTEM_ACTOR,
              reason: refund.reason ?? 'Refund completed from Razorpay webhook',
              raw: { source: 'webhook', webhook_event_id: input.eventId },
            },
            tx,
          );
          return { paymentId: lockedPayment.id, applied: true };
        }
        // Without a stable request id, wait for phase 3 to stamp/account the row. A 5xx makes
        // Razorpay redeliver rather than permanently acknowledging an early terminal event.
        if (refund.status === 'REQUESTED' && status !== 'FAILED') {
          throw new Error('Refund is still being recorded; retry the webhook.');
        }
        await tx
          .update(paymentRefunds)
          .set({
            status,
            processedAt: status === 'PENDING' ? null : new Date(),
            rawReference: sql`${paymentRefunds.rawReference} || ${JSON.stringify({ webhook_event_id: input.eventId, provider_status: input.providerStatus })}::jsonb`,
          })
          .where(eq(paymentRefunds.id, refund.id));
        // Only PENDING rows were already counted by applyRefund. A REQUESTED row has not yet
        // changed the payment and therefore has nothing to reverse.
        if (status === 'FAILED' && refund.status === 'PENDING') {
          await this.reverseRefund(tx, lockedPayment, refund);
        }
        return { paymentId: lockedPayment.id, applied: true };
      });
    }
    // Another event can reach this branch before the first has inserted its refund. Serialise
    // the provider-id claim on the payment lock and recheck while holding it, then stamp the
    // provider id at insert so no second REQUESTED row is stranded by a uniqueness error.
    const claimed = await this.db.transaction(async (tx) => {
      await lockPayment(tx, payment.id);
      const [nowKnown] = await tx
        .select({ id: paymentRefunds.id })
        .from(paymentRefunds)
        .where(eq(paymentRefunds.providerRefundId, input.providerRefundId))
        .limit(1);
      if (nowKnown) return { kind: 'known' } as const;
      if (input.refundRequestId && REFUND_REQUEST_ID.test(input.refundRequestId)) {
        const [requested] = await tx
          .select()
          .from(paymentRefunds)
          .where(eq(paymentRefunds.id, input.refundRequestId))
          .for('update')
          .limit(1);
        if (requested) {
          if (
            requested.paymentId !== payment.id ||
            requested.amountPaise !== input.amountPaise ||
            requested.status !== 'REQUESTED' ||
            requested.providerRefundId !== null
          ) {
            throw new Error('Refund webhook does not match its local request.');
          }
          await this.applyRefund(
            {
              paymentId: payment.id,
              refundId: requested.id,
              providerRefundId: input.providerRefundId,
              amountPaise: requested.amountPaise,
              providerStatus: input.providerStatus,
              actor: requested.requestedBy ? { userId: requested.requestedBy } : SYSTEM_ACTOR,
              reason: requested.reason ?? 'Refund completed from Razorpay webhook',
              raw: { source: 'webhook', webhook_event_id: input.eventId },
            },
            tx,
          );
          return { kind: 'applied' } as const;
        }
      }
      // One of ours between phases 2 and 3: the provider id is not stamped yet. Its event
      // must be retried, or an API response of PENDING can hide a terminal transition.
      const [inFlight] = await tx
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
      if (inFlight) return { kind: 'in_flight' } as const;
      if (statusFrom(input.providerStatus) === 'FAILED') return { kind: 'failed' } as const;
      const [row] = await tx
        .insert(paymentRefunds)
        .values({
          paymentId: payment.id,
          providerRefundId: input.providerRefundId,
          amountPaise: input.amountPaise,
          status: 'REQUESTED',
          reason: 'Refund made at Razorpay',
          requestedBy: null,
        })
        .returning({ id: paymentRefunds.id });
      await this.applyRefund(
        {
          paymentId: payment.id,
          refundId: row!.id,
          providerRefundId: input.providerRefundId,
          amountPaise: input.amountPaise,
          providerStatus: input.providerStatus,
          actor: SYSTEM_ACTOR,
          reason: 'Refund made at Razorpay (webhook)',
          raw: { source: 'webhook', webhook_event_id: input.eventId },
        },
        tx,
      );
      return { kind: 'applied' } as const;
    });
    if (claimed.kind === 'known') return this.applyProviderRefund(input);
    if (claimed.kind === 'in_flight') {
      throw new Error('Refund is still being recorded; retry the webhook.');
    }
    if (claimed.kind === 'failed') return { paymentId: payment.id, applied: false };
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

  private async applyRefund(
    input: {
      paymentId: string;
      refundId: string;
      providerRefundId: string;
      amountPaise: number;
      providerStatus: string;
      actor: AdminActor;
      reason: string;
      raw: Record<string, unknown>;
    },
    db: Executor = this.db,
  ): Promise<RefundOutcome> {
    return db.transaction(async (tx) => {
      const payment = await lockPayment(tx, input.paymentId);
      const [requested] = await tx
        .select()
        .from(paymentRefunds)
        .where(eq(paymentRefunds.id, input.refundId))
        .for('update')
        .limit(1);
      if (!requested || requested.paymentId !== payment.id) {
        throw new PaymentAdminError('NOT_FOUND', 'No such refund request.');
      }
      if (requested.status === 'FAILED') {
        throw new PaymentAdminError('REFUND_FAILED', 'Razorpay reported the refund failed.');
      }
      if (requested.status !== 'REQUESTED') {
        // A concurrent completion already accounted for this refund.
        const reference = requested.rawReference as Record<string, unknown>;
        return {
          refund: requested,
          payment,
          revoked: typeof reference?.['revocation_audit_id'] === 'number',
        };
      }
      const status = statusFrom(input.providerStatus);
      // Razorpay can return a terminal failure in a successful HTTP response. No money moved.
      if (status === 'FAILED') {
        const [failed] = await tx
          .update(paymentRefunds)
          .set({
            providerRefundId: input.providerRefundId,
            status,
            processedAt: new Date(),
            rawReference: input.raw,
          })
          .where(eq(paymentRefunds.id, input.refundId))
          .returning();
        return { refund: failed!, payment, revoked: false };
      }
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
      let completedRefund = refund!;

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
          .select()
          .from(subscriptions)
          .where(eq(subscriptions.businessId, payment.businessId))
          .for('update')
          .limit(1);
        if (
          subscription?.entitlementNote === `payment:${payment.id}` &&
          subscription.entitlementSource === 'PAYMENT' &&
          (subscription.status === 'PRO_ACTIVE' || subscription.status === 'PAST_DUE')
        ) {
          await new SubscriptionService(tx).revokePro(payment.businessId, {
            actor: input.actor,
            reason: `Full refund of payment ${payment.id}: ${input.reason}`,
          });
          const [cancellationAudit] = await tx
            .select({ id: adminAuditLogs.id })
            .from(adminAuditLogs)
            .where(
              and(
                eq(adminAuditLogs.action, 'business.entitlement.adjust'),
                eq(adminAuditLogs.targetType, 'subscription'),
                eq(adminAuditLogs.targetId, subscription.id),
              ),
            )
            .orderBy(desc(adminAuditLogs.id))
            .limit(1);
          if (!cancellationAudit) throw new Error('Missing full-refund entitlement audit');
          const [withAudit] = await tx
            .update(paymentRefunds)
            .set({
              rawReference: sql`${paymentRefunds.rawReference} || ${JSON.stringify({ revocation_audit_id: cancellationAudit.id })}::jsonb`,
            })
            .where(eq(paymentRefunds.id, input.refundId))
            .returning();
          completedRefund = withAudit!;
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
      return { refund: completedRefund, payment: after!, revoked };
    });
  }

  /** A refund Razorpay later failed: the money never left, so the running total comes back. */
  private async reverseRefund(tx: Executor, payment: Payment, refund: PaymentRefund) {
    const refundedPaise = payment.refundedPaise - refund.amountPaise;
    if (refundedPaise < 0) throw new Error('Pending refund exceeds the payment refund total');
    const [after] = await tx
      .update(payments)
      .set({
        refundedPaise,
        refundedAt: refundedPaise === 0 ? null : payment.refundedAt,
        status: payment.status === 'REFUNDED' ? 'CAPTURED' : payment.status,
        updatedAt: new Date(),
      })
      .where(eq(payments.id, payment.id))
      .returning();

    const restored =
      payment.status === 'REFUNDED' && (await this.restoreRefundedEntitlement(tx, payment, refund));
    await new AuditWriter(tx).record({
      actorUserId: null,
      actorType: 'SYSTEM',
      ipHash: null,
      businessId: payment.businessId,
      action: 'payment.refund',
      targetType: 'payment',
      targetId: payment.id,
      reason: `Razorpay reported refund ${refund.id} failed; amount restored`,
      before: { refunded_paise: payment.refundedPaise, status: payment.status },
      after: { refunded_paise: refundedPaise, status: after!.status, restored },
    });
  }

  private async restoreRefundedEntitlement(
    tx: Executor,
    payment: Payment,
    refund: PaymentRefund,
  ): Promise<boolean> {
    const [subscription] = await tx
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.businessId, payment.businessId))
      .for('update')
      .limit(1);
    if (
      !subscription ||
      subscription.status !== 'CANCELLED' ||
      subscription.entitlementSource !== 'NONE' ||
      subscription.entitlementNote !== null
    ) {
      return false;
    }
    const [cancellation] = await tx
      .select({
        id: adminAuditLogs.id,
        reason: adminAuditLogs.reason,
        beforeState: adminAuditLogs.beforeState,
        afterState: adminAuditLogs.afterState,
      })
      .from(adminAuditLogs)
      .where(
        and(
          eq(adminAuditLogs.action, 'business.entitlement.adjust'),
          eq(adminAuditLogs.targetType, 'subscription'),
          eq(adminAuditLogs.targetId, subscription.id),
        ),
      )
      .orderBy(desc(adminAuditLogs.id))
      .limit(1);
    if (!cancellation) return false;

    const reference = refund.rawReference as Record<string, unknown>;
    const recordedAuditId = reference?.['revocation_audit_id'];
    if (recordedAuditId !== undefined) {
      if (recordedAuditId !== cancellation.id) return false;
    } else {
      // Pending refunds created before revocation_audit_id was recorded need the immutable
      // payment audit to tie this exact refund to the cancellation.
      if (!cancellation.reason?.startsWith(`Full refund of payment ${payment.id}:`)) return false;
    }
    const [refundAudit] = await tx
      .select({ afterState: adminAuditLogs.afterState })
      .from(adminAuditLogs)
      .where(
        and(
          eq(adminAuditLogs.action, 'payment.refund'),
          eq(adminAuditLogs.targetType, 'payment'),
          eq(adminAuditLogs.targetId, payment.id),
          sql`${adminAuditLogs.afterState}->>'refund_id' = ${refund.id}`,
        ),
      )
      .limit(1);
    const refundAfter = refundAudit?.afterState as Record<string, unknown> | null | undefined;
    if (refundAfter?.['revoked'] !== true) return false;

    const before = cancellation.beforeState as Record<string, unknown> | null;
    const after = cancellation.afterState as Record<string, unknown> | null;
    if (
      before?.['entitlement_source'] !== 'PAYMENT' ||
      before['entitlement_note'] !== `payment:${payment.id}` ||
      (before['status'] !== 'PRO_ACTIVE' && before['status'] !== 'PAST_DUE') ||
      after?.['status'] !== 'CANCELLED' ||
      after['entitlement_source'] !== 'NONE' ||
      after['entitlement_note'] !== null ||
      before['starts_at'] !== subscription.startsAt?.toISOString() ||
      before['expires_at'] !== subscription.expiresAt?.toISOString()
    ) {
      return false;
    }
    const priorStatus = before['status'];
    const [restored] = await tx
      .update(subscriptions)
      .set({
        status: priorStatus,
        entitlementSource: 'PAYMENT',
        entitlementGrantedBy: null,
        entitlementNote: `payment:${payment.id}`,
        updatedAt: new Date(),
      })
      .where(eq(subscriptions.id, subscription.id))
      .returning();
    await new AuditWriter(tx).record({
      actorUserId: null,
      actorType: 'SYSTEM',
      businessId: payment.businessId,
      action: 'business.entitlement.adjust',
      targetType: 'subscription',
      targetId: subscription.id,
      reason: `Refund ${refund.id} failed; restored the paid period`,
      before: {
        status: subscription.status,
        starts_at: subscription.startsAt,
        expires_at: subscription.expiresAt,
        entitlement_source: subscription.entitlementSource,
        entitlement_note: subscription.entitlementNote,
      },
      after: {
        status: restored!.status,
        starts_at: restored!.startsAt,
        expires_at: restored!.expiresAt,
        entitlement_source: restored!.entitlementSource,
        entitlement_note: restored!.entitlementNote,
      },
    });
    return true;
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

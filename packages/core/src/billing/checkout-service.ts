import { createHash } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import {
  businesses,
  payments,
  paymentWebhookEvents,
  subscriptions,
  users,
  type Database,
  type Payment,
} from '@ai-review/db';
import { PlatformSettingsService } from '../platform/settings';
import { allocateInvoiceNumber, buildInvoiceSnapshot } from './invoice-service';
import { PaymentAdminService } from './payment-admin-service';
import { SubscriptionService } from './subscription-service';
import {
  parseWebhookEvent,
  verifyCheckoutSignature,
  verifyWebhookSignature,
  type RazorpayClient,
} from './razorpay';

/**
 * The paid path onto Pro (Flow E steps 5–8, AC-015, AC-016).
 *
 * Three entry points, one outcome. `startCheckout` creates a Razorpay order for the platform
 * price and a CREATED payment row. `completeCheckout` is the browser callback, verified by the
 * checkout signature. `handleWebhook` is Razorpay's own notification, verified by the webhook
 * signature and made idempotent by the event id. Both of the last two land in `settle`, which
 * marks the payment CAPTURED and activates Pro through the same `SubscriptionService` an admin
 * grant uses — so whichever arrives first activates, and the second one finds a CAPTURED row and
 * does nothing. That is what AC-015's "idempotent" means in practice: a redelivered webhook, or a
 * webhook racing the browser, never grants a second year.
 *
 * The subscription row's status is never touched during checkout. A business renewing early is
 * still on Pro while it pays; a status of CHECKOUT_PENDING would have taken that away.
 */

export interface CheckoutSecrets {
  keySecret: string;
  webhookSecret: string;
}

export class CheckoutError extends Error {
  constructor(
    readonly code:
      'PAYMENT_VERIFICATION_FAILED' | 'ORDER_NOT_FOUND' | 'AMOUNT_MISMATCH' | 'BUSINESS_MISMATCH',
    message: string,
  ) {
    super(message);
    this.name = 'CheckoutError';
  }
}

export interface StartedCheckout {
  paymentId: string;
  orderId: string;
  amountPaise: number;
  currency: string;
}

export interface WebhookOutcome {
  /**
   * rejected — the signature or body did not verify; nothing was recorded.
   * duplicate — this event id was already processed successfully.
   * failed — verified and recorded, but the payment it names cannot be settled (unknown order,
   *   wrong amount). Permanent: a redelivery will fail the same way, so the caller should
   *   acknowledge it and an operator should read the ledger.
   */
  status: 'processed' | 'duplicate' | 'ignored' | 'rejected' | 'failed';
  event: string | null;
  activated: boolean;
  /** The business whose payment this was, when the event reached a payment row. */
  businessId?: string;
  /** Our payments.id, when the event reached a payment row. */
  paymentId?: string;
  error?: string;
}

export class CheckoutService {
  constructor(private readonly db: Database) {}

  async startCheckout(input: {
    businessId: string;
    client: RazorpayClient;
    amountPaise: number;
    currency?: string;
  }): Promise<StartedCheckout> {
    const receipt = `sub_${input.businessId.replace(/-/g, '').slice(0, 24)}_${Date.now().toString(36)}`;
    const order = await input.client.createOrder({
      amountPaise: input.amountPaise,
      currency: input.currency ?? 'INR',
      receipt,
      notes: { business_id: input.businessId, plan: 'AI_REVIEW_PRO_ANNUAL' },
    });

    const [subscription] = await this.db
      .select({ id: subscriptions.id })
      .from(subscriptions)
      .where(eq(subscriptions.businessId, input.businessId))
      .limit(1);

    const [row] = await this.db
      .insert(payments)
      .values({
        businessId: input.businessId,
        subscriptionId: subscription?.id ?? null,
        provider: 'RAZORPAY',
        providerOrderId: order.id,
        amountPaise: order.amountPaise,
        currency: order.currency,
        status: 'CREATED',
        rawReference: { receipt, order_status: order.status },
      })
      .returning({ id: payments.id });

    return {
      paymentId: row!.id,
      orderId: order.id,
      amountPaise: order.amountPaise,
      currency: order.currency,
    };
  }

  /**
   * The browser's callback after Checkout.js succeeds. The signature is proof Razorpay saw this
   * order paid by this payment; the order must also be one this business started.
   */
  async completeCheckout(input: {
    businessId: string;
    orderId: string;
    paymentId: string;
    signature: string;
    secrets: CheckoutSecrets;
  }): Promise<{ payment: Payment; activated: boolean }> {
    if (
      !verifyCheckoutSignature(
        { orderId: input.orderId, paymentId: input.paymentId, signature: input.signature },
        input.secrets.keySecret,
      )
    ) {
      throw new CheckoutError('PAYMENT_VERIFICATION_FAILED', 'checkout signature did not verify');
    }
    return this.settleOrder({
      orderId: input.orderId,
      providerPaymentId: input.paymentId,
      expectedBusinessId: input.businessId,
      amountPaise: null,
      reference: { source: 'checkout_callback' },
    });
  }

  /**
   * Razorpay's server-to-server notification. Verified against the raw body, recorded by event
   * id before anything else so a redelivery is a no-op, then settled like the callback.
   */
  async handleWebhook(input: {
    rawBody: string;
    signature: string | null;
    eventId: string | null;
    secrets: CheckoutSecrets;
  }): Promise<WebhookOutcome> {
    if (!verifyWebhookSignature(input.rawBody, input.signature, input.secrets.webhookSecret)) {
      return { status: 'rejected', event: null, activated: false };
    }
    const event = parseWebhookEvent(input.rawBody);
    if (!event) return { status: 'rejected', event: null, activated: false };

    const payloadHash = createHash('sha256').update(input.rawBody).digest('hex');
    // Razorpay sends X-Razorpay-Event-Id; without one, the body hash stands in for it, which is
    // still a correct dedupe key for an identical redelivery.
    const providerEventId = input.eventId?.trim() || `sha256:${payloadHash}`;
    const inserted = await this.db
      .insert(paymentWebhookEvents)
      .values({ provider: 'RAZORPAY', providerEventId, eventType: event.event, payloadHash })
      .onConflictDoNothing({ target: paymentWebhookEvents.providerEventId })
      .returning({ id: paymentWebhookEvents.id });

    let ledgerId: string;
    if (inserted.length > 0) {
      ledgerId = inserted[0]!.id;
    } else {
      // Seen before. Only a delivery that finished cleanly is a duplicate; one that failed, or
      // one whose process died mid-way and never wrote an outcome, is processed again. That is
      // safe because settle is idempotent, and it is what makes Razorpay's retries useful
      // instead of a second copy of the same lost event.
      const [existing] = await this.db
        .select({
          id: paymentWebhookEvents.id,
          processedAt: paymentWebhookEvents.processedAt,
          processingError: paymentWebhookEvents.processingError,
        })
        .from(paymentWebhookEvents)
        .where(eq(paymentWebhookEvents.providerEventId, providerEventId))
        .limit(1);
      if (!existing || (existing.processedAt && !existing.processingError)) {
        return { status: 'duplicate', event: event.event, activated: false };
      }
      ledgerId = existing.id;
    }

    // The ledger row carries the payment it landed on and how it ended (AMENDMENT-029), so
    // the admin's webhook screen needs no payload to say what happened.
    const finish = async (outcome: WebhookOutcome, error?: string, paymentRowId?: string) => {
      await this.db
        .update(paymentWebhookEvents)
        .set({
          processedAt: new Date(),
          processingError: error ?? null,
          outcome: outcome.status,
          ...(paymentRowId ? { paymentId: paymentRowId } : {}),
        })
        .where(eq(paymentWebhookEvents.id, ledgerId));
      return outcome;
    };
    const paymentRowFor = async (orderId: string | null, providerPaymentId: string | null) => {
      if (orderId) {
        const [row] = await this.db
          .select({ id: payments.id })
          .from(payments)
          .where(eq(payments.providerOrderId, orderId))
          .limit(1);
        if (row) return row.id;
      }
      if (providerPaymentId) {
        const [row] = await this.db
          .select({ id: payments.id })
          .from(payments)
          .where(eq(payments.providerPaymentId, providerPaymentId))
          .limit(1);
        if (row) return row.id;
      }
      return undefined;
    };

    try {
      if (event.event === 'payment.captured' || event.event === 'order.paid') {
        if (!event.orderId)
          return finish({ status: 'ignored', event: event.event, activated: false });
        const { activated, payment } = await this.settleOrder({
          orderId: event.orderId,
          providerPaymentId: event.paymentId,
          expectedBusinessId: null,
          amountPaise: event.amountPaise,
          reference: { source: 'webhook', event: event.event, event_id: providerEventId },
        });
        return finish(
          {
            status: 'processed',
            event: event.event,
            activated,
            businessId: payment.businessId,
            paymentId: payment.id,
          },
          undefined,
          payment.id,
        );
      }
      if (event.event === 'payment.failed' && event.orderId) {
        const reason = [event.errorCode, event.errorDescription].filter(Boolean).join(': ');
        const [failed] = await this.db
          .update(payments)
          .set({
            status: 'FAILED',
            providerPaymentId: event.paymentId,
            failureReason: reason ? reason.slice(0, 500) : null,
            updatedAt: new Date(),
            rawReference: { source: 'webhook', event: event.event, event_id: providerEventId },
          })
          .where(and(eq(payments.providerOrderId, event.orderId), eq(payments.status, 'CREATED')))
          .returning({ id: payments.id, businessId: payments.businessId });
        return finish(
          {
            status: 'processed',
            event: event.event,
            activated: false,
            ...(failed ? { businessId: failed.businessId } : {}),
          },
          undefined,
          failed?.id ?? (await paymentRowFor(event.orderId, event.paymentId)),
        );
      }
      if (event.event.startsWith('refund.') && event.refundId && event.paymentId) {
        // A refund made from the Razorpay dashboard, or the settlement of one this product
        // asked for. Either way the ledger names the payment.
        const applied = await new PaymentAdminService(this.db).applyProviderRefund({
          providerPaymentId: event.paymentId,
          providerRefundId: event.refundId,
          amountPaise: event.refundAmountPaise ?? 0,
          providerStatus: event.refundStatus ?? event.event.replace('refund.', ''),
          eventId: providerEventId,
        });
        if (!applied) return finish({ status: 'ignored', event: event.event, activated: false });
        const [owner] = await this.db
          .select({ businessId: payments.businessId })
          .from(payments)
          .where(eq(payments.id, applied.paymentId))
          .limit(1);
        return finish(
          {
            status: applied.applied ? 'processed' : 'duplicate',
            event: event.event,
            activated: false,
            ...(owner ? { businessId: owner.businessId } : {}),
          },
          undefined,
          applied.paymentId,
        );
      }
      return finish(
        { status: 'ignored', event: event.event, activated: false },
        undefined,
        await paymentRowFor(event.orderId, event.paymentId),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof CheckoutError) {
        // Permanent for this event: the order is not ours or the amount is wrong. Recorded, and
        // reported as failed rather than thrown, so the route can acknowledge it and Razorpay
        // stops retrying something that will never succeed.
        return finish(
          { status: 'failed', event: event.event, activated: false, error: error.code },
          `${error.code}: ${message}`,
          await paymentRowFor(event.orderId, event.paymentId),
        );
      }
      // Anything else — the database going away mid-settle — is worth a retry, so the ledger
      // keeps the error and the route answers with a 5xx that makes Razorpay redeliver.
      await finish({ status: 'failed', event: event.event, activated: false }, message);
      throw error;
    }
  }

  /** Payments for a business, newest first — SUB-01's history and the receipts list. */
  async history(businessId: string): Promise<Payment[]> {
    return this.db
      .select()
      .from(payments)
      .where(eq(payments.businessId, businessId))
      .orderBy(desc(payments.createdAt))
      .limit(50);
  }

  /**
   * One place that turns a paid order into a Pro year, exactly once. The payment row is locked;
   * a CAPTURED row returns without activating — that is the idempotency AC-015 asks for.
   *
   * Public so an admin can reconcile a payment Razorpay captured but never told us about
   * (AMENDMENT-029): the same path, the same checks, the same invoice.
   */
  async settleOrder(input: {
    orderId: string;
    providerPaymentId: string | null;
    expectedBusinessId: string | null;
    amountPaise: number | null;
    reference: Record<string, unknown>;
  }): Promise<{ payment: Payment; activated: boolean }> {
    // Read before the transaction: the seller's details do not change mid-settle, and the
    // settings service reads through the pool.
    const seller = await new PlatformSettingsService(this.db).values();
    return this.db.transaction(async (tx) => {
      const [payment] = await tx
        .select()
        .from(payments)
        .where(eq(payments.providerOrderId, input.orderId))
        .for('update')
        .limit(1);
      if (!payment) throw new CheckoutError('ORDER_NOT_FOUND', 'no payment for that order');
      if (input.expectedBusinessId && payment.businessId !== input.expectedBusinessId) {
        throw new CheckoutError('BUSINESS_MISMATCH', 'that order belongs to another business');
      }
      if (input.amountPaise !== null && input.amountPaise !== payment.amountPaise) {
        throw new CheckoutError('AMOUNT_MISMATCH', 'paid amount does not match the order');
      }
      if (payment.status === 'CAPTURED') return { payment, activated: false };

      const [captured] = await tx
        .update(payments)
        .set({
          status: 'CAPTURED',
          providerPaymentId: input.providerPaymentId ?? payment.providerPaymentId,
          paidAt: new Date(),
          rawReference: { ...(payment.rawReference as object), ...input.reference },
        })
        .where(eq(payments.id, payment.id))
        .returning();

      // The same activation an admin grant uses; the transaction handle keeps the two writes
      // together. SubscriptionService opens its own transaction on the executor it is given.
      const activated = await new SubscriptionService(tx).activatePro(payment.businessId, {
        source: 'PAYMENT',
        paymentId: payment.id,
      });
      // The period this payment bought, kept on the payment itself: the subscription row only
      // ever shows the current period, and a receipt for last year's payment must still say
      // what last year's payment covered. The invoice is issued in the same statement — number,
      // tax split and both parties as they were at the moment of sale — and only when the row
      // has none yet, so a later price or GST change never rewrites it (ADMIN-04-02).
      const paidAt = captured!.paidAt ?? new Date();
      const invoice = captured!.invoiceNumber
        ? {}
        : await this.issueInvoice(tx, {
            businessId: payment.businessId,
            grossPaise: payment.amountPaise,
            paidAt,
            seller,
          });
      const [receipted] = await tx
        .update(payments)
        .set({
          rawReference: {
            ...(captured!.rawReference as object),
            period_starts_at: activated.startsAt?.toISOString() ?? null,
            period_expires_at: activated.expiresAt?.toISOString() ?? null,
          },
          ...invoice,
        })
        .where(eq(payments.id, payment.id))
        .returning();
      return { payment: receipted!, activated: true };
    });
  }

  private async issueInvoice(
    tx: Parameters<Parameters<Database['transaction']>[0]>[0],
    input: {
      businessId: string;
      grossPaise: number;
      paidAt: Date;
      seller: Awaited<ReturnType<PlatformSettingsService['values']>>;
    },
  ) {
    const [buyer] = await tx
      .select({
        businessName: businesses.name,
        billingLegalName: businesses.billingLegalName,
        gstin: businesses.gstin,
        stateCode: businesses.billingStateCode,
        address: businesses.billingAddress,
        email: users.email,
      })
      .from(businesses)
      .innerJoin(users, eq(users.id, businesses.ownerUserId))
      .where(eq(businesses.id, input.businessId))
      .limit(1);
    if (!buyer) throw new CheckoutError('ORDER_NOT_FOUND', 'no business for that payment');
    const snapshot = buildInvoiceSnapshot({
      seller: input.seller,
      buyer: { businessId: input.businessId, ...buyer },
      grossPaise: input.grossPaise,
    });
    const invoiceNumber = await allocateInvoiceNumber(tx, {
      prefix: input.seller.invoice_prefix,
      at: input.paidAt,
    });
    return {
      invoiceNumber,
      invoiceIssuedAt: input.paidAt,
      taxBreakdown: snapshot.tax,
      sellerSnapshot: snapshot.seller,
      buyerSnapshot: snapshot.buyer,
    };
  }
}

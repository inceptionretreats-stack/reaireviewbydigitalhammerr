import { NextResponse, type NextRequest, after } from 'next/server';
import { checkoutVerifyRequest } from '@ai-review/contracts';
import { analyticsEvents } from '@ai-review/db';
import { CheckoutError, CheckoutService } from '@ai-review/core';
import type { EventPayload } from '@ai-review/analytics';
import { db } from '@/lib/db';
import { apiError } from '@/lib/api-error';
import { requireTenant } from '@/lib/require-tenant';
import { loadSubscriptionView, razorpayConfig, subscriptionToWire } from '@/lib/subscription';
import { recordActivity } from '@/lib/activity';
import { sendReceipt } from '@/lib/billing/receipt-mail';

export const runtime = 'nodejs';

/**
 * POST /api/v1/subscription/verify — Flow E step 6, the browser half (AC-015, AC-016).
 *
 * Checkout.js hands the page an order id, a payment id and a signature; the signature is
 * Razorpay's HMAC over the first two with the key secret, so a body that verifies is proof that
 * Razorpay saw this order paid. The order must also be one this business started. Anything
 * else — a forged signature, someone else's order, an order never created here — is one answer,
 * PAYMENT_VERIFICATION_FAILED, so a probe learns nothing about which check it failed.
 *
 * Idempotent with the webhook: whichever arrives first activates the year; the other finds a
 * CAPTURED payment and activates nothing.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireTenant(request);
  if (!auth.ok) return auth.response;

  const config = razorpayConfig();
  if (!config) {
    return apiError('PAYMENTS_NOT_CONFIGURED', 'Online payment is not set up on this platform.');
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return apiError('VALIDATION_FAILED', 'Malformed request body.');
  }
  const parsed = checkoutVerifyRequest.safeParse(raw);
  if (!parsed.success) {
    return apiError('PAYMENT_VERIFICATION_FAILED', 'We could not verify this payment.', {
      details: {
        fields: [...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? 'body')))],
      },
    });
  }

  const database = db();
  const businessId = auth.context.businessId;
  let outcome;
  try {
    outcome = await new CheckoutService(database).completeCheckout({
      businessId,
      orderId: parsed.data.razorpay_order_id,
      paymentId: parsed.data.razorpay_payment_id,
      signature: parsed.data.razorpay_signature,
      secrets: { keySecret: config.keySecret, webhookSecret: config.webhookSecret },
    });
  } catch (error) {
    if (error instanceof CheckoutError) {
      console.warn('[billing] checkout verification refused', {
        businessId,
        code: error.code,
        orderId: parsed.data.razorpay_order_id,
      });
      return apiError(
        'PAYMENT_VERIFICATION_FAILED',
        'We could not verify this payment. If money left your account, it will be matched to your plan automatically; contact Digital Hammerr if your plan has not changed within an hour.',
      );
    }
    throw error;
  }

  if (outcome.activated) {
    // The receipt goes out once the response is on its way (AMENDMENT-029).
    after(() => sendReceipt(outcome.payment.id));
    const properties: EventPayload<'subscription_activated'> = {
      business_id: businessId,
      provider: 'RAZORPAY',
    };
    try {
      await database
        .insert(analyticsEvents)
        .values({ businessId, eventName: 'subscription_activated', properties });
    } catch (error) {
      console.warn('[analytics] subscription_activated failed', error);
    }
  }

  recordActivity(
    request,
    { session: auth.context.session, businessId },
    {
      action: 'subscription.checkout.verify',
      targetType: 'payment',
      targetId: outcome.payment.id,
      metadata: { activated: outcome.activated },
    },
  );
  const view = await loadSubscriptionView(database, businessId);
  return NextResponse.json({
    activated: outcome.activated,
    payment_status: outcome.payment.status,
    subscription: view ? subscriptionToWire(view) : null,
  });
}

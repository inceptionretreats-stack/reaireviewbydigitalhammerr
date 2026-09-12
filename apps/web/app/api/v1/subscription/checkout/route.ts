import { NextResponse, type NextRequest } from 'next/server';
import { analyticsEvents } from '@ai-review/db';
import { CheckoutService, PlatformSettingsService, RazorpayError } from '@ai-review/core';
import type { EventPayload } from '@ai-review/analytics';
import { db } from '@/lib/db';
import { apiError } from '@/lib/api-error';
import { requireActiveTenant, requireTenant } from '@/lib/require-tenant';
import { loadSubscriptionView, razorpayClient, razorpayConfig } from '@/lib/subscription';

export const runtime = 'nodejs';

/**
 * POST /api/v1/subscription/checkout — Flow E step 5 (E10-02).
 *
 * Creates a Razorpay order for the platform's annual price and answers with what Checkout.js
 * needs to open: the public key id, the order, the amount, and the business's own name for the
 * sheet. The secret never leaves the server; the amount is decided here from
 * `platform_settings.annual_price_paise`, never taken from the browser.
 *
 * Without Razorpay keys the answer is PAYMENTS_NOT_CONFIGURED, which the page turns into a
 * sentence — an operator can still activate Pro from the admin panel, so a deployment may run
 * without online payment on purpose.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireTenant(request);
  if (!auth.ok) return auth.response;
  const frozen = requireActiveTenant(auth.context);
  if (frozen) return frozen;

  const config = razorpayConfig();
  if (!config) {
    return apiError(
      'PAYMENTS_NOT_CONFIGURED',
      'Online payment is not set up on this platform yet. Contact Digital Hammerr to upgrade.',
    );
  }

  const database = db();
  const businessId = auth.context.businessId;
  const view = await loadSubscriptionView(database, businessId);
  if (!view) return apiError('RESOURCE_NOT_FOUND', 'We could not find a plan for this business.');

  const amountPaise = (await new PlatformSettingsService(database).values()).annual_price_paise;

  let started;
  try {
    started = await new CheckoutService(database).startCheckout({
      businessId,
      client: razorpayClient(config),
      amountPaise,
    });
  } catch (error) {
    if (error instanceof RazorpayError) {
      // The message names Razorpay's status and error code and nothing from the request; the
      // person sees a sentence they can act on.
      console.error('[billing] order creation failed', { businessId, message: error.message });
      return apiError(
        'PAYMENT_VERIFICATION_FAILED',
        error.code === 'TIMEOUT'
          ? 'Razorpay did not answer in time. Please try again.'
          : 'We could not start the payment. Please try again in a moment.',
      );
    }
    throw error;
  }

  const properties: EventPayload<'subscription_checkout_started'> = {
    business_id: businessId,
    amount_paise: started.amountPaise,
    plan_code: 'AI_REVIEW_PRO_ANNUAL',
  };
  try {
    await database
      .insert(analyticsEvents)
      .values({ businessId, eventName: 'subscription_checkout_started', properties });
  } catch (error) {
    console.warn('[analytics] subscription_checkout_started failed', error);
  }

  return NextResponse.json(
    {
      key_id: config.keyId,
      order_id: started.orderId,
      payment_id: started.paymentId,
      amount_paise: started.amountPaise,
      currency: started.currency,
      business_name: view.business.name,
      // Prefilled on the Razorpay sheet so the owner is not retyping their own details to pay.
      // It reaches Razorpay only when the owner opens the sheet, and only for their own payment.
      prefill: { name: view.owner.name, email: view.owner.email },
    },
    { status: 201 },
  );
}

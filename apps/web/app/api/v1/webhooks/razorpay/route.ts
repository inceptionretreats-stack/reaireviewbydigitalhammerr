import { NextResponse, type NextRequest } from 'next/server';
import { analyticsEvents } from '@ai-review/db';
import { CheckoutService } from '@ai-review/core';
import type { EventPayload } from '@ai-review/analytics';
import { db } from '@/lib/db';
import { apiError } from '@/lib/api-error';
import { razorpayConfig } from '@/lib/subscription';

export const runtime = 'nodejs';

/**
 * POST /api/v1/webhooks/razorpay — Flow E step 6, Razorpay's half (E10-03, AC-015, AC-016).
 *
 * No session and no CSRF check: the caller is Razorpay, not a browser, and the proof is the
 * `X-Razorpay-Signature` header — an HMAC over the raw body with the webhook secret. The body
 * is read as text and verified byte for byte before it is parsed; a reserialised body is a
 * different byte string and would not verify.
 *
 * Answers, and why: 400 for a body that does not verify (Razorpay will retry, and should not
 * — but a forged request gets nothing else); 503 while the secret is not configured, so a
 * webhook registered early is retried until it is; 200 for processed, duplicate and ignored,
 * and for a permanent failure the ledger has recorded, because a retry would fail the same way.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const config = razorpayConfig();
  if (!config) {
    return apiError('PAYMENTS_NOT_CONFIGURED', 'Webhook secret is not configured.');
  }

  const rawBody = await request.text();
  if (rawBody.length > 256 * 1024) {
    return apiError('VALIDATION_FAILED', 'Payload too large.');
  }

  const database = db();
  const outcome = await new CheckoutService(database).handleWebhook({
    rawBody,
    signature: request.headers.get('x-razorpay-signature'),
    eventId: request.headers.get('x-razorpay-event-id'),
    secrets: { keySecret: config.keySecret, webhookSecret: config.webhookSecret },
  });

  if (outcome.status === 'rejected') {
    console.warn('[billing] webhook rejected: signature or body did not verify');
    return apiError('PAYMENT_VERIFICATION_FAILED', 'Signature did not verify.');
  }

  if (outcome.status === 'failed') {
    console.error('[billing] webhook failed', { event: outcome.event, error: outcome.error });
  }

  if (outcome.activated && outcome.businessId) {
    const properties: EventPayload<'subscription_activated'> = {
      business_id: outcome.businessId,
      provider: 'RAZORPAY',
    };
    try {
      await database.insert(analyticsEvents).values({
        businessId: outcome.businessId,
        eventName: 'subscription_activated',
        properties,
      });
    } catch (error) {
      console.warn('[analytics] subscription_activated failed', error);
    }
  }

  return NextResponse.json({
    status: outcome.status,
    event: outcome.event,
    activated: outcome.activated,
  });
}

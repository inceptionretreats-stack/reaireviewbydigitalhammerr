import { NextResponse } from 'next/server';
import { PaymentAdminError, PaymentAdminService, type PaymentListRow } from '@ai-review/core';
import type { AdminPaymentListQuery, AdminWebhookQuery } from '@ai-review/contracts';
import { apiError } from '@/lib/api-error';
import { db } from '@/lib/db';

/** AMENDMENT-029 — the payment control service composed for the web app, and its error map. */
export function paymentAdmin(): PaymentAdminService {
  return new PaymentAdminService(db());
}

export function paymentErrorResponse(error: unknown): NextResponse | null {
  if (!(error instanceof PaymentAdminError)) return null;
  switch (error.code) {
    case 'NOT_FOUND':
      return apiError('RESOURCE_NOT_FOUND', 'No such payment.');
    case 'STATE_INVALID':
      return apiError('PAYMENT_STATE_INVALID', error.message);
    case 'AMOUNT_INVALID':
      return apiError('VALIDATION_FAILED', error.message, {
        details: { fields: ['amount_paise'] },
      });
    case 'REFUND_FAILED':
      return apiError('REFUND_FAILED', error.message);
    case 'NOT_CONFIGURED':
      return apiError('PAYMENTS_NOT_CONFIGURED', 'Razorpay keys are not configured.');
  }
}

export function paymentFilterFrom(q: AdminPaymentListQuery) {
  return {
    status: q.status,
    businessId: q.business,
    from: q.from,
    to: q.to,
    refunded: q.refunded === 'yes' ? true : q.refunded === 'no' ? false : undefined,
    beforeId: q.before,
  };
}

export function webhookFilterFrom(q: AdminWebhookQuery) {
  return { outcome: q.outcome, eventType: q.event, beforeId: q.before };
}

export function paymentRowToWire(r: PaymentListRow) {
  return {
    id: r.id,
    business_id: r.businessId,
    business_name: r.businessName,
    owner_email: r.ownerEmail,
    status: r.status,
    amount_paise: r.amountPaise,
    refunded_paise: r.refundedPaise,
    currency: r.currency,
    provider_order_id: r.providerOrderId,
    provider_payment_id: r.providerPaymentId,
    invoice_number: r.invoiceNumber,
    failure_reason: r.failureReason,
    created_at: r.createdAt.toISOString(),
    paid_at: r.paidAt?.toISOString() ?? null,
    refunded_at: r.refundedAt?.toISOString() ?? null,
    receipt_emailed_at: r.receiptEmailedAt?.toISOString() ?? null,
    last_webhook: r.lastWebhook
      ? {
          event: r.lastWebhook.eventType,
          outcome: r.lastWebhook.outcome,
          at: r.lastWebhook.at.toISOString(),
        }
      : null,
  };
}

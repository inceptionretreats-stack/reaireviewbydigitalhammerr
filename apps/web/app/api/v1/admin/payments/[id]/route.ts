import { NextResponse } from 'next/server';
import { apiError } from '@/lib/http/api-error';
import { requireAdmin } from '@/lib/auth/require-admin';
import { paymentAdmin } from '@/lib/admin/payments';

export const runtime = 'nodejs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GET /api/v1/admin/payments/{id} — one payment with its refunds, webhooks and audit. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(request, { allowViewer: true });
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!UUID.test(id)) return apiError('RESOURCE_NOT_FOUND', 'No such payment.');
  const detail = await paymentAdmin().get(id);
  if (!detail) return apiError('RESOURCE_NOT_FOUND', 'No such payment.');
  const p = detail.payment;
  const reference = p.rawReference as Record<string, unknown>;
  return NextResponse.json({
    payment: {
      id: p.id,
      business_id: p.businessId,
      status: p.status,
      amount_paise: p.amountPaise,
      refunded_paise: p.refundedPaise,
      currency: p.currency,
      provider_order_id: p.providerOrderId,
      provider_payment_id: p.providerPaymentId,
      invoice_number: p.invoiceNumber,
      failure_reason: p.failureReason,
      tax_breakdown: p.taxBreakdown,
      created_at: p.createdAt.toISOString(),
      paid_at: p.paidAt?.toISOString() ?? null,
      refunded_at: p.refundedAt?.toISOString() ?? null,
      receipt_emailed_at: p.receiptEmailedAt?.toISOString() ?? null,
      period: {
        starts_at: reference['period_starts_at'] ?? null,
        expires_at: reference['period_expires_at'] ?? null,
      },
    },
    business: detail.business,
    owner: detail.owner,
    subscription: detail.subscription
      ? {
          status: detail.subscription.status,
          expires_at: detail.subscription.expiresAt?.toISOString() ?? null,
        }
      : null,
    funds_current_period: detail.fundsCurrentPeriod,
    refunds: detail.refunds.map((r) => ({
      id: r.id,
      provider_refund_id: r.providerRefundId,
      amount_paise: r.amountPaise,
      status: r.status,
      reason: r.reason,
      error: r.error,
      created_at: r.createdAt.toISOString(),
      processed_at: r.processedAt?.toISOString() ?? null,
    })),
    webhooks: detail.webhooks.map((w) => ({
      id: w.id,
      event: w.eventType,
      outcome: w.outcome,
      error: w.processingError,
      created_at: w.createdAt.toISOString(),
    })),
    audit: detail.audit.map((a) => ({
      id: a.id,
      action: a.action,
      actor: a.actorType === 'SYSTEM' ? 'system' : (a.actorEmail ?? 'unknown'),
      reason: a.reason,
      created_at: a.createdAt.toISOString(),
    })),
  });
}

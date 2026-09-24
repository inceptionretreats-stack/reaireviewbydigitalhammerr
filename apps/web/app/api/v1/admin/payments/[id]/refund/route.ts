import { NextResponse } from 'next/server';
import { adminPaymentRefund } from '@ai-review/contracts';
import { AuditReasonRequiredError } from '@ai-review/core';
import { apiError } from '@/lib/http/api-error';
import { readJsonObject } from '@/lib/http/request-body';
import { requireAdmin } from '@/lib/auth/require-admin';
import { paymentAdmin, paymentErrorResponse } from '@/lib/admin/payments';
import { razorpayClient, razorpayConfig } from '@/lib/billing/subscription';

export const runtime = 'nodejs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/v1/admin/payments/{id}/refund — money leaves, so a fresh MFA code (step-up) and a
 * reason are both demanded (AMENDMENT-029). Without Razorpay keys the answer is 503: nothing
 * is recorded for a refund that cannot be made.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(request, { stepUp: true });
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!UUID.test(id)) return apiError('RESOURCE_NOT_FOUND', 'No such payment.');

  const rawResult = await readJsonObject(request);
  if (!rawResult.ok) return rawResult.response;
  const raw = rawResult.body;
  const parsed = adminPaymentRefund.safeParse(raw);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? 'body')))];
    if (fields.includes('reason')) {
      return apiError(
        'ADMIN_REASON_REQUIRED',
        'A reason is required; it is written to the audit log.',
      );
    }
    return apiError('VALIDATION_FAILED', 'Check the amount.', { details: { fields } });
  }

  const config = razorpayConfig();
  if (!config) {
    return apiError(
      'PAYMENTS_NOT_CONFIGURED',
      'Razorpay keys are not configured on this platform.',
    );
  }

  try {
    const outcome = await paymentAdmin().refund(id, {
      actor: auth.context.actor,
      reason: parsed.data.reason,
      amountPaise: parsed.data.amount_paise,
      client: razorpayClient(config),
    });
    return NextResponse.json({
      refund: {
        id: outcome.refund.id,
        provider_refund_id: outcome.refund.providerRefundId,
        amount_paise: outcome.refund.amountPaise,
        status: outcome.refund.status,
      },
      payment: { status: outcome.payment.status, refunded_paise: outcome.payment.refundedPaise },
      revoked: outcome.revoked,
    });
  } catch (error) {
    if (error instanceof AuditReasonRequiredError) {
      return apiError(
        'ADMIN_REASON_REQUIRED',
        'A reason is required; it is written to the audit log.',
      );
    }
    const mapped = paymentErrorResponse(error);
    if (mapped) return mapped;
    throw error;
  }
}

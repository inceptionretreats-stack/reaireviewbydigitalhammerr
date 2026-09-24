import { NextResponse } from 'next/server';
import { adminPaymentAction } from '@ai-review/contracts';
import { AuditReasonRequiredError } from '@ai-review/core';
import { apiError } from '@/lib/http/api-error';
import { readJsonObject } from '@/lib/http/request-body';
import { requireAdmin } from '@/lib/auth/require-admin';
import { paymentAdmin, paymentErrorResponse } from '@/lib/admin/payments';
import { sendReceipt } from '@/lib/billing/receipt-mail';
import { razorpayClient, razorpayConfig } from '@/lib/billing/subscription';

export const runtime = 'nodejs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/v1/admin/payments/{id}/actions — reconcile, mark_failed, resend_receipt
 * (AMENDMENT-029). None moves money, so no step-up; reconcile and mark_failed are audited
 * with the reason, resend_receipt is an email and is recorded on the payment itself.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!UUID.test(id)) return apiError('RESOURCE_NOT_FOUND', 'No such payment.');

  const rawResult = await readJsonObject(request);
  if (!rawResult.ok) return rawResult.response;
  const raw = rawResult.body;
  const parsed = adminPaymentAction.safeParse(raw);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? 'body')))];
    if (fields.includes('reason')) {
      return apiError(
        'ADMIN_REASON_REQUIRED',
        'A reason is required; it is written to the audit log.',
      );
    }
    return apiError('VALIDATION_FAILED', 'Unknown action.', { details: { fields } });
  }
  const { action, reason } = parsed.data;
  const service = paymentAdmin();

  try {
    if (action === 'mark_failed') {
      const payment = await service.markFailed(id, { actor: auth.context.actor, reason });
      return NextResponse.json({ payment: { status: payment.status } });
    }
    if (action === 'reconcile') {
      const config = razorpayConfig();
      if (!config) {
        return apiError(
          'PAYMENTS_NOT_CONFIGURED',
          'Razorpay keys are not configured on this platform.',
        );
      }
      const outcome = await service.reconcile(id, {
        actor: auth.context.actor,
        reason,
        client: razorpayClient(config),
      });
      return NextResponse.json({
        payment: {
          status: outcome.payment.status,
          invoice_number: outcome.payment.invoiceNumber,
        },
        activated: outcome.activated,
        provider_status: outcome.providerStatus,
      });
    }
    const sent = await sendReceipt(id);
    return NextResponse.json({ sent: sent.sent, reason: sent.reason ?? null });
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

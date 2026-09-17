import { NextResponse } from 'next/server';
import { adminWebhookQuery } from '@ai-review/contracts';
import { apiError } from '@/lib/api-error';
import { requireAdmin } from '@/lib/require-admin';
import { paymentAdmin, webhookFilterFrom } from '@/lib/admin/payments';

export const runtime = 'nodejs';

/** GET /api/v1/admin/payments/webhooks — the delivery ledger (AMENDMENT-029). */
export async function GET(request: Request) {
  const auth = await requireAdmin(request, { allowViewer: true });
  if (!auth.ok) return auth.response;
  const url = new URL(request.url);
  const parsed = adminWebhookQuery.safeParse(Object.fromEntries(url.searchParams.entries()));
  if (!parsed.success) {
    return apiError('VALIDATION_FAILED', 'Check the filters.', {
      details: {
        fields: [...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? 'query')))],
      },
    });
  }
  const { rows, nextBefore } = await paymentAdmin().listWebhookEvents(
    webhookFilterFrom(parsed.data),
  );
  return NextResponse.json({
    events: rows.map((r) => ({
      id: r.id,
      event: r.eventType,
      provider_event_id: r.providerEventId,
      outcome: r.outcome,
      error: r.processingError,
      payment_id: r.paymentId,
      business_id: r.businessId,
      business_name: r.businessName,
      created_at: r.createdAt.toISOString(),
      processed_at: r.processedAt?.toISOString() ?? null,
    })),
    next_before: nextBefore,
  });
}

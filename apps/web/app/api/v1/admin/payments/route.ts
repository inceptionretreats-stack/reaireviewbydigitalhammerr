import { NextResponse } from 'next/server';
import { adminPaymentListQuery } from '@ai-review/contracts';
import { apiError } from '@/lib/api-error';
import { requireAdmin } from '@/lib/require-admin';
import { paymentAdmin, paymentFilterFrom, paymentRowToWire } from '@/lib/admin/payments';

export const runtime = 'nodejs';

/** GET /api/v1/admin/payments — every tenant's payments, newest first (AMENDMENT-029). */
export async function GET(request: Request) {
  const auth = await requireAdmin(request, { allowViewer: true });
  if (!auth.ok) return auth.response;
  const url = new URL(request.url);
  const parsed = adminPaymentListQuery.safeParse(Object.fromEntries(url.searchParams.entries()));
  if (!parsed.success) {
    return apiError('VALIDATION_FAILED', 'Check the filters.', {
      details: {
        fields: [...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? 'query')))],
      },
    });
  }
  const { rows, nextBefore } = await paymentAdmin().list(paymentFilterFrom(parsed.data));
  return NextResponse.json({ payments: rows.map(paymentRowToWire), next_before: nextBefore });
}

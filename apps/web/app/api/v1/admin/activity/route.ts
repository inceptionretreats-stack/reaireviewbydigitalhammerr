import { NextResponse } from 'next/server';
import { adminActivityQuery } from '@ai-review/contracts';
import { apiError } from '@/lib/api-error';
import { requireAdmin } from '@/lib/require-admin';
import { activityFilterFrom, loadActivity } from '@/lib/admin/activity';

export const runtime = 'nodejs';

/** GET /api/v1/admin/activity — the explorer as JSON (AMENDMENT-028). Read-only; viewers may. */
export async function GET(request: Request) {
  const auth = await requireAdmin(request, { allowViewer: true });
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const parsed = adminActivityQuery.safeParse(Object.fromEntries(url.searchParams.entries()));
  if (!parsed.success) {
    return apiError('VALIDATION_FAILED', 'Check the filters.', {
      details: {
        fields: [...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? 'query')))],
      },
    });
  }
  const { rows, nextBefore } = await loadActivity(await activityFilterFrom(parsed.data));
  return NextResponse.json({
    entries: rows.map((r) => ({
      id: r.id,
      occurred_at: r.occurredAt.toISOString(),
      user_id: r.userId,
      user_email: r.userEmail,
      business_id: r.businessId,
      business_name: r.businessName,
      action: r.action,
      outcome: r.outcome,
      target_type: r.targetType,
      target_id: r.targetId,
      metadata: r.metadata,
      ip_hash: r.ipHash,
    })),
    next_before: nextBefore,
  });
}

import { NextResponse } from 'next/server';
import { adminBusinessListQuery } from '@ai-review/contracts';
import { db } from '@/lib/infra/db';
import { apiError } from '@/lib/http/api-error';
import { requireAdmin } from '@/lib/auth/require-admin';
import { listBusinesses } from '@/lib/admin/businesses';

export const runtime = 'nodejs';

/** ADMIN-02: search and filter every tenant. */
export async function GET(request: Request) {
  const auth = await requireAdmin(request, { allowViewer: true });
  if (!auth.ok) return auth.response;

  const params = Object.fromEntries(new URL(request.url).searchParams.entries());
  const parsed = adminBusinessListQuery.safeParse(params);
  if (!parsed.success) {
    return apiError('VALIDATION_FAILED', 'Please check the filters.', {
      details: {
        fields: [...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? 'query')))],
      },
    });
  }
  return NextResponse.json(await listBusinesses(db(), parsed.data));
}

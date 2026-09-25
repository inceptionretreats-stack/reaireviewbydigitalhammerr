import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/lib/infra/db';
import { apiError } from '@/lib/http/api-error';
import { requireTenant } from '@/lib/tenant/require-tenant';
import { loadSubscriptionView, subscriptionToWire } from '@/lib/billing/subscription';

export const runtime = 'nodejs';

/**
 * GET /api/v1/subscription — plan, entitlement, usage and payment history (SUB-01, E10-04).
 *
 * The same loader the page uses, so a client refreshing after a payment sees exactly what a
 * reload would show.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireTenant(request);
  if (!auth.ok) return auth.response;

  const view = await loadSubscriptionView(db(), auth.context.businessId);
  if (!view) return apiError('RESOURCE_NOT_FOUND', 'We could not find a plan for this business.');
  return NextResponse.json(subscriptionToWire(view));
}

import { NextResponse, type NextRequest } from 'next/server';
import { eq, sql } from 'drizzle-orm';
import { businesses } from '@ai-review/db';
import { billingDetailsRequest } from '@ai-review/contracts';
import { db } from '@/lib/infra/db';
import { apiError } from '@/lib/http/api-error';
import { readJsonObject } from '@/lib/http/request-body';
import { requireTenant } from '@/lib/tenant/require-tenant';
import { recordActivity } from '@/lib/activity/recorder';

export const runtime = 'nodejs';

/**
 * GET/PUT /api/v1/business/billing — the buyer side of the GST invoice (AMENDMENT-029).
 *
 * The details are copied onto each invoice at the moment of sale, so a change here affects the
 * next payment's invoice and never an issued one. Allowed while suspended: a business that owes
 * nothing and can publish nothing can still put its legal name right for the invoice it holds.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireTenant(request);
  if (!auth.ok) return auth.response;
  const [row] = await db()
    .select({
      billingLegalName: businesses.billingLegalName,
      gstin: businesses.gstin,
      billingStateCode: businesses.billingStateCode,
      billingAddress: businesses.billingAddress,
    })
    .from(businesses)
    .where(eq(businesses.id, auth.context.businessId))
    .limit(1);
  return NextResponse.json(shape(row));
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  const auth = await requireTenant(request);
  if (!auth.ok) return auth.response;

  const rawResult = await readJsonObject(request);
  if (!rawResult.ok) return rawResult.response;
  const raw = rawResult.body;
  const parsed = billingDetailsRequest.safeParse(raw);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? 'body')))];
    return apiError('VALIDATION_FAILED', parsed.error.issues[0]?.message ?? 'Check the details.', {
      details: { fields },
    });
  }
  const details = parsed.data;
  const orNull = (v: string) => (v === '' ? null : v);

  const [row] = await db()
    .update(businesses)
    .set({
      billingLegalName: orNull(details.billing_legal_name),
      gstin: orNull(details.gstin),
      billingStateCode: orNull(details.billing_state_code),
      billingAddress: orNull(details.billing_address),
      updatedAt: sql`now()`,
    })
    .where(eq(businesses.id, auth.context.businessId))
    .returning({
      billingLegalName: businesses.billingLegalName,
      gstin: businesses.gstin,
      billingStateCode: businesses.billingStateCode,
      billingAddress: businesses.billingAddress,
    });

  recordActivity(
    request,
    { session: auth.context.session, businessId: auth.context.businessId },
    {
      action: 'business.billing.update',
      targetType: 'business',
      targetId: auth.context.businessId,
      metadata: { has_gstin: details.gstin !== '' },
    },
  );
  return NextResponse.json(shape(row));
}

function shape(
  row:
    | {
        billingLegalName: string | null;
        gstin: string | null;
        billingStateCode: string | null;
        billingAddress: string | null;
      }
    | undefined,
) {
  return {
    billing_legal_name: row?.billingLegalName ?? '',
    gstin: row?.gstin ?? '',
    billing_state_code: row?.billingStateCode ?? '',
    billing_address: row?.billingAddress ?? '',
  };
}

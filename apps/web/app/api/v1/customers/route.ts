import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/lib/infra/db';
import { apiError } from '@/lib/http/api-error';
import { readJsonObject } from '@/lib/http/request-body';
import { requireTenant } from '@/lib/tenant/require-tenant';
import { readCustomerBody } from '@/lib/crm/customers/body';
import { parseListQuery } from '@/lib/crm/customers/query';
import { createCustomer, loadCustomerPage, toCustomerDto } from '@/lib/crm/customers/repository';
import { recordActivity } from '@/lib/activity/recorder';

/**
 * GET/POST /api/v1/customers — the `list`, `empty` and `form` states of CRM-01.
 *
 * The tenant is never taken from the request: `requireTenant` resolves it from the session, so there
 * is no business id in the URL or body for a caller to tamper with (RBAC rule 2, AC-003).
 *
 * Deliberately not gated on `requireActiveTenant`. Flow J describes what a suspension does — the
 * public page shows as unavailable and AI generation stops — and says nothing about the owner's own
 * records; and gating here would also lock out a DRAFT tenant, who is mid-onboarding and perfectly
 * entitled to start writing down the customers they mean to ask. The place an inactive tenant has to
 * be stopped is REQ-01, where a prepared message would carry a link to a page that does not resolve.
 *
 * No analytics event is written by either handler. `11_Analytics_Event_Taxonomy.csv` defines
 * `review_request_prepared` and `review_request_marked_sent` but nothing for adding, editing or
 * deleting a contact, and the taxonomy is the contract — CI regenerates the event types from it and
 * fails on a diff (AN-01-01). An event for these routes belongs in the CSV first, not in a handler.
 *
 * What is *not* here is the point of CRM-01-01 and D-018: no bulk actions, no import, no export, no
 * campaign, no segment. This is a list of people to ask for a review, one at a time, and every
 * endpoint that would make it a marketing tool is absent rather than disabled.
 */

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireTenant(request);
  if (!auth.ok) return auth.response;

  const query = parseListQuery(new URL(request.url).searchParams);
  const page = await loadCustomerPage(db(), auth.context.businessId, query);

  return NextResponse.json(page);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireTenant(request);
  if (!auth.ok) return auth.response;

  const rawResult = await readJsonObject(request);
  if (!rawResult.ok) return rawResult.response;
  const raw = rawResult.body;

  const parsed = readCustomerBody(raw, 'create');
  if (!parsed.ok) {
    return apiError('VALIDATION_FAILED', parsed.message, {
      details: { fields: [...parsed.fields] },
    });
  }

  const created = await createCustomer(db(), auth.context.businessId, parsed.body.values);

  if (!created.ok) {
    // Reported against the mobile field so the form can point at it. The existing contact is named
    // because it belongs to this same tenant and because "already on your list" without saying who
    // leaves the owner searching for a row they cannot see from the add form.
    return apiError(
      'VALIDATION_FAILED',
      `${created.existing.name} is already on your list with this number. Edit that contact instead.`,
      { details: { fields: ['mobile'] } },
    );
  }

  recordActivity(
    request,
    { session: auth.context.session, businessId: auth.context.businessId },
    {
      action: 'customer.create',
      targetType: 'customer',
      targetId: created.customer.id,
    },
  );
  return NextResponse.json({ customer: toCustomerDto(created.customer) }, { status: 201 });
}

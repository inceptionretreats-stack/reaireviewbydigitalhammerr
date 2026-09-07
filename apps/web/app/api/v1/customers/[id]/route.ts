import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { apiError } from '@/lib/api-error';
import { requireTenant } from '@/lib/require-tenant';
import { readCustomerBody } from '../body';
import { isUuid } from '../query';
import {
  softDeleteCustomer,
  toCustomerDto,
  updateCustomer,
  type UpdateOutcome,
} from '../repository';

/**
 * PATCH/DELETE /api/v1/customers/{id} — the `Edit` and `Delete` actions of CRM-01.
 *
 * These are the two endpoints in this module that carry an id, so they are the two AC-003 is really
 * about. The id is never trusted: it is paired with the tenant resolved from the session inside the
 * WHERE clause of every statement (`repository.ts`), so another tenant's contact is not fetched and
 * then rejected — it is not fetched at all.
 *
 * A contact that does not exist, one that belongs to somebody else, and one that has already been
 * deleted therefore all produce the identical 404 below. That is what stops the endpoint being used
 * to discover which ids are real, which is the enumeration half of the same criterion.
 */

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireTenant(request);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  // Checked before the query rather than trusted into it: a non-uuid makes Postgres raise 22P02,
  // which would surface as a 500 for what is plainly a request for something that does not exist.
  if (!isUuid(id)) return notFound();

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return apiError('VALIDATION_FAILED', 'Malformed request body.');
  }

  const parsed = readCustomerBody(raw, 'update');
  if (!parsed.ok) {
    return apiError('VALIDATION_FAILED', parsed.message, {
      details: { fields: [...parsed.fields] },
    });
  }

  const outcome = await updateCustomer(db(), auth.context.businessId, id, {
    ...parsed.body.values,
    ...(parsed.body.status === undefined ? {} : { status: parsed.body.status }),
  });

  if (!outcome.ok) return describeUpdateFailure(outcome);

  return NextResponse.json({ customer: toCustomerDto(outcome.customer) });
}

/** The three ways an edit can be refused, each with copy the owner can act on. */
function describeUpdateFailure(outcome: Extract<UpdateOutcome, { ok: false }>): NextResponse {
  switch (outcome.reason) {
    case 'NOT_FOUND':
      return notFound();
    case 'MOBILE_TAKEN':
      return apiError(
        'VALIDATION_FAILED',
        `${outcome.existing.name} is already on your list with this number.`,
        { details: { fields: ['mobile'] } },
      );
    case 'STATUS_LOCKED':
      // The row has moved past the point where the owner's own record is the only source of truth:
      // the platform has observed the customer, and an observation must not be overwritable, or the
      // funnel reports whatever the owner last selected instead of what happened (D-028, AC-025).
      return apiError(
        'VALIDATION_FAILED',
        'This contact’s status now records what happened on your review page, so it cannot be changed by hand.',
        { details: { fields: ['status'] } },
      );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireTenant(request);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  /*
   * Soft, per AC-040 and CRM-01-02: `deleted_at` is stamped, the contact leaves every list, and the
   * row stays. Three reasons it is not a hard delete, in the order they matter.
   *
   * `review_requests.customer_id` is `ON DELETE CASCADE`, so removing the row would silently take
   * every review request ever prepared for that person with it — and with them the attribution Flow
   * F step 9 is built on. `13_Security_Privacy_Compliance.md` asks for personal fields to be purged
   * "after a grace period", which is a scheduled job and presupposes a row to purge. And the partial
   * index on `(business_id, mobile) WHERE deleted_at IS NULL` is written so that a deleted contact's
   * number is free again — which only means anything if the deleted row is still there.
   */
  const deleted = await softDeleteCustomer(db(), auth.context.businessId, id);
  if (!deleted) return notFound();

  // 204, as `08_OpenAPI_v1.yaml` declares. No body: there is nothing to say that the status code
  // does not, and a client parsing JSON out of a 204 is a bug waiting to be written.
  return new NextResponse(null, { status: 204 });
}

function notFound(): NextResponse {
  return apiError('RESOURCE_NOT_FOUND', 'We could not find that customer.');
}

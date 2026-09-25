import { NextResponse, type NextRequest } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { privateFeedback } from '@ai-review/db';
import { db } from '@/lib/infra/db';
import { apiError } from '@/lib/http/api-error';
import { readJsonObject } from '@/lib/http/request-body';
import { requireTenant } from '@/lib/tenant/require-tenant';
import type { AssignableFeedbackStatus } from '@/lib/feedback/filters';
import { recordActivity } from '@/lib/activity/recorder';

/**
 * PATCH /api/v1/feedback/{id} — the Mark read and Archive actions of FB-02.
 *
 * Filing, never deleting. `private_feedback` has no soft-delete column and this handler writes
 * nothing but `status`: ARCHIVED means the message has left the inbox view, and it stays readable
 * through the `archived` and `all` filters afterwards. Nothing on this screen destroys what a
 * customer wrote.
 *
 * ## AC-003, and why the check is in the WHERE clause
 *
 * `id` arrives in the URL, which is the exact IDOR shape AC-003 tests for. Ownership is therefore
 * part of the statement rather than a check on a row already fetched: the UPDATE cannot touch
 * another tenant's row at all, and there is no fetched-then-forgotten branch for a later edit to
 * get wrong. A missing row and another tenant's row both come back as zero rows and are answered
 * identically, so this endpoint cannot be used to discover which feedback ids exist.
 *
 * Deliberately not gated on `requireActiveTenant`. Flow J stops a suspended tenant changing its
 * *configuration* — the public page, the review destination, the QR sources. Marking a customer's
 * message read is not configuration; it changes nothing a customer can see, and refusing it would
 * only stop a suspended owner keeping track of correspondence they are still entitled to read.
 *
 * No analytics event is written: `11_Analytics_Event_Taxonomy.csv` defines none for a merchant
 * filing their inbox, and the taxonomy is the contract (AN-01-01).
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The two states this screen can put a message into.
 *
 * NEW is not among them, and that is a product statement rather than an oversight: NEW means the
 * owner has never opened it, which stops being true the moment they do. FB-02's actions are View,
 * Mark read and Archive, so there is no control that would send it and no honest meaning for one.
 * Restoring an archived message therefore returns it to READ, which is what it is.
 */
const ASSIGNABLE_STATUS: Record<AssignableFeedbackStatus, AssignableFeedbackStatus> = {
  READ: 'READ',
  ARCHIVED: 'ARCHIVED',
};

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireTenant(request);
  if (!auth.ok) return auth.response;

  const { id } = await params;

  // Checked before the query rather than trusted into it: a non-uuid makes Postgres raise 22P02,
  // which would surface as a 500 for what is plainly a request for something that does not exist.
  if (!UUID_PATTERN.test(id)) return notFound();

  const rawResult = await readJsonObject(request);
  if (!rawResult.ok) return rawResult.response;
  const raw = rawResult.body;

  const status = readStatus(raw);
  if (status === null) {
    return apiError('VALIDATION_FAILED', 'Choose either Mark read or Archive.', {
      details: { fields: ['status'] },
    });
  }

  const [updated] = await db()
    .update(privateFeedback)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(privateFeedback.id, id), eq(privateFeedback.businessId, auth.context.businessId)))
    .returning({
      id: privateFeedback.id,
      status: privateFeedback.status,
      updatedAt: privateFeedback.updatedAt,
    });

  if (!updated) return notFound();

  // The message, name and mobile are deliberately not echoed back. The caller already has them
  // from the list, nothing in the flow needs them again, and the less often customer contact
  // details cross the wire the smaller the surface AC-039 has to hold.
  recordActivity(
    request,
    { session: auth.context.session, businessId: auth.context.businessId },
    {
      action: 'feedback.update',
      targetType: 'private_feedback',
      targetId: updated.id,
      metadata: { status: updated.status },
    },
  );
  return NextResponse.json(
    { id: updated.id, status: updated.status, updated_at: updated.updatedAt.toISOString() },
    { headers: { 'Cache-Control': 'no-store, private' } },
  );
}

function readStatus(raw: unknown): AssignableFeedbackStatus | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = (raw as Record<string, unknown>).status;
  if (typeof value !== 'string') return null;
  // Case-sensitive: the value the list handed the client is the value it sends back, so there is no
  // reason to accept a spelling the database does not use. `hasOwn` rather than an index read, so a
  // body of `{"status":"constructor"}` cannot reach the prototype chain.
  if (!Object.hasOwn(ASSIGNABLE_STATUS, value)) return null;
  return ASSIGNABLE_STATUS[value as AssignableFeedbackStatus];
}

/**
 * RESOURCE_NOT_FOUND — "absent/inaccessible" in 23_API_Error_Codes.md — answers "no such row" and
 * "not yours" identically, which is what stops this endpoint being an existence oracle for another
 * tenant's ids (AC-003).
 */
function notFound(): NextResponse {
  return apiError('RESOURCE_NOT_FOUND', 'We could not find that message.');
}

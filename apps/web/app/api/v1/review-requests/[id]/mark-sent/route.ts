import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { apiError } from '@/lib/api-error';
import { requireTenant } from '@/lib/require-tenant';
import {
  advanceCustomerStatus,
  isUuid,
  loadOwnedRequest,
  markSent,
  recordMarkedSentEvent,
} from '../../service';
import { recordActivity } from '@/lib/activity';

/**
 * POST /api/v1/review-requests/{id}/mark-sent — Flow F step 8.
 *
 * This endpoint records a claim the owner makes about the physical world: they sent the message from
 * their own WhatsApp. It is not, and must never read as, the platform sending anything (D-017,
 * ADR-004, REQ-01-02). AC-023 requires the resulting status to be clearly a manual business action,
 * which is why the column and every field name below say *marked* sent rather than sent.
 *
 * Deliberately not gated on `requireActiveTenant`, unlike creating a request. A suspension stops a
 * tenant changing its configuration (Flow J); it cannot un-send a message that has already left the
 * owner's phone, and refusing to record it would only make the history wrong.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireTenant(request);
  if (!auth.ok) return auth.response;

  const { id } = await params;

  // Shape-checked before the query: a non-uuid would make Postgres raise 22P02 and surface as a 500
  // for what is plainly a request for something that does not exist.
  if (!isUuid(id)) return notFound();

  const database = db();
  const { businessId } = auth.context;

  // Ownership is inside the WHERE clause, so another tenant's request id cannot be read at all —
  // the IDOR shape AC-003 tests for. Missing and not-yours are answered identically below.
  const existing = await loadOwnedRequest(database, businessId, id);
  if (!existing) return notFound();

  if (existing.markedSentAt !== null) {
    // Already marked. Answered as success rather than as a conflict: the owner's intent — "this one
    // is sent" — is satisfied, and the screen only needs the timestamp to show. No second event is
    // written, or one manual action would be counted twice.
    return NextResponse.json({
      id: existing.id,
      marked_sent_at: existing.markedSentAt.toISOString(),
      already_marked: true,
    });
  }

  const stampedAt = await markSent(database, existing.id);

  if (stampedAt === null) {
    // Two clicks raced and the other one won. The conditional UPDATE kept the first timestamp, which
    // is the point of it; re-read and report that one rather than inventing a second.
    const current = await loadOwnedRequest(database, businessId, id);
    return NextResponse.json({
      id,
      marked_sent_at: current?.markedSentAt?.toISOString() ?? null,
      already_marked: true,
    });
  }

  /*
   * Best-effort, and after the write that matters — see the same reasoning in the create handler.
   * A failed status advance must not turn a recorded action into an error the owner will retry.
   */
  try {
    await advanceCustomerStatus(database, businessId, existing.customerId, 'MESSAGE_SENT_MANUAL');
  } catch (error) {
    console.warn('[review-requests] status advance failed after mark-sent', error);
  }

  await recordMarkedSentEvent(database, {
    businessId,
    customerId: existing.customerId,
    requestId: existing.id,
  });

  recordActivity(
    request,
    { session: auth.context.session, businessId },
    {
      action: 'review_request.mark_sent',
      targetType: 'review_request',
      targetId: existing.id,
    },
  );
  return NextResponse.json({
    id: existing.id,
    marked_sent_at: stampedAt.toISOString(),
    already_marked: false,
  });
}

function notFound(): NextResponse {
  return apiError('RESOURCE_NOT_FOUND', 'We could not find that review request.');
}

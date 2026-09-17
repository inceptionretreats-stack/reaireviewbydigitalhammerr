import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { apiError } from '@/lib/api-error';
import { requireTenant } from '@/lib/require-tenant';
import { isModeId, modeNotFound, refuseFrozenTenant } from '../guards';
import { toWireMode, updateMode } from '../mode-service';
import { parseUpdateMode } from '../schema';
import { recordActivity } from '@/lib/activity';

/**
 * PATCH /api/v1/ai/modes/{id} — the `edit` and `archived` states of AI-02.
 *
 * This handler carries both Edit and Archive because archiving is a field change, not a deletion:
 * a mode is referenced by ai_generations.review_mode_id, so removing rows would erase which mode
 * produced past drafts. 08_OpenAPI_v1.yaml names the operation "Edit/archive review mode" for the
 * same reason, and the screen spec lists no Delete.
 *
 * The id in the path is never trusted. `updateMode` puts the resolved tenant in the WHERE clause,
 * so another tenant's mode cannot be reached at all, and a missing row and someone else's row come
 * back as the same 404 — the IDOR shape AC-003 tests for (RBAC rule 2).
 *
 * Activation is not available here. AI-02-01 requires exactly one active mode, which is one
 * transaction in `POST /ai/modes/{id}/activate`; `parseUpdateMode` rejects `is_active` outright
 * rather than quietly dropping it, so a client that tries cannot believe it succeeded.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireTenant(request);
  if (!auth.ok) return auth.response;

  const frozen = refuseFrozenTenant(auth.context.status);
  if (frozen) return frozen;

  const { id } = await params;
  if (!isModeId(id)) return modeNotFound();

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return apiError('VALIDATION_FAILED', 'Malformed request body.');
  }

  const parsed = parseUpdateMode(raw);
  if (!parsed.ok) {
    return apiError('VALIDATION_FAILED', parsed.message, {
      details: { fields: [...parsed.fields] },
    });
  }

  const updated = await updateMode(db(), auth.context.businessId, id, parsed.value);
  if (!updated.ok) return updateFailure(updated.reason);

  recordActivity(
    request,
    { session: auth.context.session, businessId: auth.context.businessId },
    {
      action: 'ai.mode.update',
      targetType: 'review_mode',
      targetId: id,
    },
  );
  return NextResponse.json({ mode: toWireMode(updated.mode) });
}

/**
 * Every failure of `updateMode`, mapped to a code from 23_API_Error_Codes.md and a message that is
 * safe to show a person.
 */
function updateFailure(reason: 'NOT_FOUND' | 'NAME_TAKEN' | 'ACTIVE_CANNOT_ARCHIVE'): NextResponse {
  switch (reason) {
    case 'NOT_FOUND':
      return modeNotFound();

    case 'NAME_TAKEN':
      // uq_review_mode_name is per business, so this is only ever the owner's own collision.
      return apiError('VALIDATION_FAILED', 'You already have a mode with that name.', {
        details: { fields: ['name'] },
      });

    case 'ACTIVE_CANNOT_ARCHIVE':
      // AI-02-02 says an archived mode cannot be active. Rather than silently deactivating the mode
      // in use — which would leave the tenant generating with no mode at all — the request is
      // refused and the owner is told what to do first. Named against the archive field so the
      // message lands on the control they pressed. 23_API_Error_Codes.md has no general conflict
      // code, and 422 is the honest fit: this change is not valid for this row.
      return apiError(
        'VALIDATION_FAILED',
        'This mode is currently in use. Switch to another mode first, then archive this one.',
        { details: { fields: ['is_archived'] } },
      );
  }
}

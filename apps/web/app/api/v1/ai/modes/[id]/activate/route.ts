import { NextResponse, type NextRequest } from 'next/server';
import { apiError } from '@/lib/http/api-error';
import { db } from '@/lib/infra/db';
import { requireTenant } from '@/lib/tenant/require-tenant';
import { isModeId, modeNotFound, refuseFrozenTenant } from '@/lib/ai/modes/guards';
import { activateMode, toWireMode } from '@/lib/ai/modes/mode-service';
import { recordActivity } from '@/lib/activity/recorder';

/**
 * POST /api/v1/ai/modes/{id}/activate — the Activate action of AI-02.
 *
 * A separate endpoint rather than a field on PATCH because AI-02-01 ("only one active mode at a
 * time") is an invariant across two rows, not a property of one. `activateMode` does it as a single
 * transaction that deactivates the current mode and activates the requested one, and catches the
 * `uq_one_active_mode` violation instead of reading which mode is active and writing based on the
 * answer — that read-then-write is a race with a second tab, and its loser leaves the tenant with
 * two active modes or none.
 *
 * The id in the path is ownership-checked inside the same transaction's WHERE clauses, so a mode
 * belonging to another tenant is unreachable and indistinguishable from one that does not exist
 * (AC-003, RBAC rule 2).
 *
 * No request body is read at all, so there is nothing to validate: the mode is named by the path
 * and the tenant by the session.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireTenant(request);
  if (!auth.ok) return auth.response;

  const frozen = refuseFrozenTenant(auth.context.status);
  if (frozen) return frozen;

  const { id } = await params;
  if (!isModeId(id)) return modeNotFound();

  const result = await activateMode(db(), auth.context.businessId, id);
  if (!result.ok) return activationFailure(result.reason);

  recordActivity(
    request,
    { session: auth.context.session, businessId: auth.context.businessId },
    {
      action: 'ai.mode.activate',
      targetType: 'review_mode',
      targetId: id,
      metadata: { previous_active_mode_id: result.previousActiveModeId },
    },
  );
  return NextResponse.json({
    active_mode: toWireMode(result.mode),
    // Named for the same reason `/api/v1/business` returns `previous_slug`: the owner should be
    // told what stopped being in use, not have to infer it from a list that has already changed.
    previous_active_mode_id: result.previousActiveModeId,
    // AI-02-03, from the endpoint that would know if it were false. Nothing in the activation
    // transaction touches qr_codes, and a printed code encodes only the opaque dynamic URL
    // (ADR-002, D-026), so every standee keeps resolving exactly where it did before.
    qr_codes_unaffected: true,
  });
}

/**
 * Every failure of `activateMode`, mapped to a code from 23_API_Error_Codes.md and a message that
 * is safe to show a person.
 */
function activationFailure(reason: 'NOT_FOUND' | 'ARCHIVED' | 'CONTENDED'): NextResponse {
  switch (reason) {
    case 'NOT_FOUND':
      return modeNotFound();

    case 'ARCHIVED':
      // AI-02-02. Reported rather than silently un-archiving: restoring a mode the owner
      // deliberately put away is their decision, not a side effect of a click.
      return apiError(
        'VALIDATION_FAILED',
        'This mode is archived. Restore it first, then set it as the one in use.',
        { details: { fields: ['is_archived'] } },
      );

    case 'CONTENDED':
      // Two sessions switching modes at the same instant, twice over. Nothing is half-applied — the
      // transaction rolled back — so retrying really is the fix, and saying so is more useful than
      // a generic failure. 23_API_Error_Codes.md has no conflict code that fits this, so it reports
      // as an internal error with a message that describes the actual situation; adding a CONFLICT
      // code would need a spec amendment.
      return apiError(
        'INTERNAL_ERROR',
        'Your modes were being changed somewhere else at the same moment. Nothing changed — ' +
          'please try again.',
      );
  }
}

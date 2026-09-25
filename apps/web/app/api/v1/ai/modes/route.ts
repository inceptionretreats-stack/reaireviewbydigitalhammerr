import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/lib/infra/db';
import { apiError } from '@/lib/http/api-error';
import { readJsonObject } from '@/lib/http/request-body';
import { requireTenant } from '@/lib/tenant/require-tenant';
import { refuseFrozenTenant } from '@/lib/ai/modes/guards';
import { MODE_CREATE_LIMIT, createMode, listModes, toWireMode } from '@/lib/ai/modes/mode-service';
import { parseCreateMode } from '@/lib/ai/modes/schema';
import { recordActivity } from '@/lib/activity/recorder';

/**
 * GET/POST /api/v1/ai/modes — the `list` and `create` states of AI-02.
 *
 * The tenant is never taken from the request: `requireTenant` resolves it from the session, so
 * there is no business id in the URL or body for a caller to tamper with (RBAC rule 2, AC-003).
 *
 * What this endpoint cannot express is as much a part of the specification as what it can. A mode
 * shifts which topics a draft leans on and nothing else — 09_AI_Prompt_and_Generation_Spec.md is
 * explicit that a mode must never mean "positive only", "5 star" or "negative suppress" — so
 * `parseCreateMode` has no field that could carry sentiment, and neither does the table.
 *
 * No analytics event is written. 11_Analytics_Event_Taxonomy.csv defines no event for configuration
 * changes, and the taxonomy is the contract: CI regenerates the event types from the CSV and fails
 * on a diff (AN-01-01), so an event for this route has to be added there first rather than invented
 * in a handler.
 */

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireTenant(request);
  if (!auth.ok) return auth.response;

  const modes = await listModes(db(), auth.context.businessId);

  return NextResponse.json({
    modes: modes.map(toWireMode),
    // AI-02-03, stated in the payload for the same reason `/ai/test-preview` returns
    // `counts_toward_quota: false`: the screen's central reassurance should come from the API that
    // knows it is true, not from a sentence a later edit could quietly make false. Nothing in this
    // module reads or writes qr_codes — a printed code encodes only the opaque dynamic URL
    // (ADR-002, D-026), so no mode change can alter where a standee points.
    qr_codes_unaffected: true,
  });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireTenant(request);
  if (!auth.ok) return auth.response;

  const frozen = refuseFrozenTenant(auth.context.status);
  if (frozen) return frozen;

  const rawResult = await readJsonObject(request);
  if (!rawResult.ok) return rawResult.response;
  const raw = rawResult.body;

  const parsed = parseCreateMode(raw);
  if (!parsed.ok) {
    return apiError('VALIDATION_FAILED', parsed.message, {
      details: { fields: [...parsed.fields] },
    });
  }

  const created = await createMode(db(), auth.context.businessId, parsed.value);

  if (!created.ok) return createFailure(created.reason);

  recordActivity(
    request,
    { session: auth.context.session, businessId: auth.context.businessId },
    {
      action: 'ai.mode.create',
      targetType: 'review_mode',
      targetId: created.mode.id,
    },
  );
  return NextResponse.json({ mode: toWireMode(created.mode) }, { status: 201 });
}

/** Every failure of `createMode`, mapped to a code from 23_API_Error_Codes.md. */
function createFailure(reason: 'NAME_TAKEN' | 'LIMIT_REACHED'): NextResponse {
  switch (reason) {
    case 'NAME_TAKEN':
      // uq_review_mode_name is per business, so this is only ever the owner's own naming collision.
      // Reported as a validation failure against the name field rather than as a conflict: from the
      // owner's side it is a correction to make in the form, and there is no mode-specific conflict
      // code in 23_API_Error_Codes.md to reach for.
      return apiError('VALIDATION_FAILED', 'You already have a mode with that name.', {
        details: { fields: ['name'] },
      });

    case 'LIMIT_REACHED':
      // The ceiling exists so `GET` above never has to truncate: `listModes` caps its SELECT, and a
      // truncated list would silently omit the newest rows — including, since activation does not
      // reorder them, the mode actually in use. The screen derives "which mode is in use" from this
      // list, so a truncated one would have it tell the owner that no mode is in use while
      // generation was using one. Shaped like `POST /api/v1/qr`'s cap, `details.limit` included, so
      // a client can say what the number is rather than guess.
      return apiError(
        'VALIDATION_FAILED',
        `You already have ${MODE_CREATE_LIMIT} review modes, which is the most we support. ` +
          'Archived modes still count — rename or reuse one instead of adding another.',
        { details: { limit: MODE_CREATE_LIMIT } },
      );
  }
}

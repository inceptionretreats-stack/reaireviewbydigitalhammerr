import { NextResponse, type NextRequest } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { qrCodes } from '@ai-review/db';
import { buildQrUrl } from '@ai-review/core';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { apiError } from '@/lib/api-error';
import { requireActiveTenant, requireTenant } from '@/lib/require-tenant';
import { parseQrSourcePatch, isQrSourceId, toQrSourceWire } from '../qr-source';

/**
 * PATCH /api/v1/qr/{id} — the Rename, Disable and Enable actions of QR-01.
 *
 * What this endpoint deliberately cannot do is as important as what it does.
 *
 * There is no DELETE. QR-01-02 wants a retired standee to resolve to a controlled, business-safe
 * state, because the standee is still on a counter somewhere and a customer is standing in front
 * of it right now; a deleted row would answer 404. Disabling is the retirement path, and
 * `resolveByQrCode` in `lib/public-business.ts` is what turns it into that controlled page.
 *
 * It also cannot change `code`. QR-01-01 makes the opaque code immutable for the life of the row —
 * that single indirection (ADR-002, D-026) is what lets the label, the Google URL, the web address
 * and the custom domain all change without reprinting anything. `parseQrSourcePatch` refuses a
 * `code` in the body outright rather than letting Zod strip it, so a client cannot come away
 * believing it renamed the printed code.
 *
 * Gated on `requireActiveTenant`: Flow J makes a suspended or closed tenant unable to mutate its
 * own configuration, and a QR source's status decides what the public sees, so a suspension that
 * left it editable would be cosmetic. A DRAFT tenant is refused by the same check, which is
 * consistent — publish is what creates the first source (ONB-05-01), so a DRAFT tenant has none.
 *
 * No analytics event is written. `11_Analytics_Event_Taxonomy.csv` defines `qr_created` and
 * `qr_scan` and nothing for a rename or a status change, and the taxonomy is the contract — CI
 * regenerates the event types from it and fails on a diff (AN-01-01). An event for this route has
 * to be added to the CSV first, not invented in a handler.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireTenant(request);
  if (!auth.ok) return auth.response;

  const inactive = requireActiveTenant(auth.context);
  if (inactive) return inactive;

  const { id } = await params;
  if (!isQrSourceId(id)) return notFound();

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return apiError('VALIDATION_FAILED', 'Malformed request body.');
  }

  const parsed = parseQrSourcePatch(raw);
  if (!parsed.ok) {
    return apiError('VALIDATION_FAILED', parsed.message, {
      ...(parsed.fields.length > 0 ? { details: { fields: parsed.fields } } : {}),
    });
  }

  const patch = parsed.value;

  const [updated] = await db()
    .update(qrCodes)
    .set({
      // Spread rather than assigned individually: an absent key must leave the column alone,
      // and `internal_note` distinguishes absent (unchanged) from null (cleared).
      ...(patch.sourceLabel !== undefined ? { sourceLabel: patch.sourceLabel } : {}),
      ...(patch.internalNote !== undefined ? { internalNote: patch.internalNote } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      updatedAt: new Date(),
    })
    // Ownership is part of the WHERE clause, not a check on a row read first. An id in a URL is
    // exactly the IDOR shape AC-003 tests for, and a QR code is a locator rather than an
    // authorization token (RBAC rule 3) — so this statement cannot touch another tenant's row at
    // all, and no fetched-then-forgotten branch is left for a later edit to get wrong.
    .where(and(eq(qrCodes.id, id), eq(qrCodes.businessId, auth.context.businessId)))
    .returning({
      id: qrCodes.id,
      code: qrCodes.code,
      sourceLabel: qrCodes.sourceLabel,
      internalNote: qrCodes.internalNote,
      status: qrCodes.status,
      createdAt: qrCodes.createdAt,
    });

  // Zero rows updated answers "no such source" and "not yours" identically, which is what stops
  // this endpoint being an existence oracle for another tenant's ids (AC-003).
  if (!updated) return notFound();

  /*
   * businesses.config_version is deliberately NOT bumped here, unlike every other configuration
   * write (`/business`, `/business/links`, `/ai/context`). That marker exists to invalidate a
   * cached *business* projection, and a QR row is not part of one: `resolveByQrCode` reads the
   * status and label fresh on every scan, which is what makes a disable take effect immediately
   * (QR-01-02) with no invalidation at all. If a future cache ever folds the QR row into that
   * projection, this is where the bump belongs.
   */

  return NextResponse.json({
    source: toQrSourceWire(updated, buildQrUrl(env().APP_BASE_URL, updated.code)),
  });
}

/**
 * RESOURCE_NOT_FOUND — "absent/inaccessible" in 23_API_Error_Codes.md — covers a malformed id, a
 * missing row and another tenant's row alike. QR_NOT_FOUND stays reserved for public /r/{code}
 * resolution, where the subject genuinely is an unknown printed code.
 */
function notFound(): NextResponse {
  return apiError('RESOURCE_NOT_FOUND', 'We could not find that QR code.');
}

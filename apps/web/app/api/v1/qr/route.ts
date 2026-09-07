import { NextResponse, type NextRequest } from 'next/server';
import { asc, eq } from 'drizzle-orm';
import { qrCodes } from '@ai-review/db';
import { buildQrUrl } from '@ai-review/core';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { requireTenant } from '@/lib/require-tenant';

/**
 * GET /api/v1/qr — the `list` state of QR-01.
 *
 * The tenant is never taken from the request: requireTenant resolves it from the session, so there
 * is no business id in the URL or body for a caller to tamper with (RBAC rule 2, AC-003).
 *
 * Deliberately not gated on requireActiveTenant. Flow J restricts a suspended tenant from
 * *mutating* its configuration; this is a read, and a suspended owner still needs to see which
 * standees exist in order to understand what their customers are currently hitting.
 *
 * No analytics event is written here. 11_Analytics_Event_Taxonomy.csv defines qr_created and
 * qr_scan but nothing for listing or downloading, and the taxonomy is the contract — CI regenerates
 * the event types from it and fails on a diff (AN-01-01). An event for these routes has to be added
 * to the CSV first, not invented in a handler.
 */

/**
 * A tenant has a handful of standees, so QR-01 specifies no pagination and `/qr` declares none in
 * 08_OpenAPI_v1.yaml. The cap is here so that an unbounded SELECT can never turn into a
 * multi-megabyte response; if a real tenant ever reaches it, `/qr` needs proper pagination rather
 * than a larger number on this line.
 */
const MAX_SOURCES = 500;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireTenant(request);
  if (!auth.ok) return auth.response;

  const rows = await db()
    .select({
      id: qrCodes.id,
      code: qrCodes.code,
      sourceLabel: qrCodes.sourceLabel,
      internalNote: qrCodes.internalNote,
      status: qrCodes.status,
      createdAt: qrCodes.createdAt,
    })
    .from(qrCodes)
    .where(eq(qrCodes.businessId, auth.context.businessId))
    // Oldest first, so the default source created at publish (ONB-05-01) stays at the top of the
    // list and the order does not reshuffle under the owner as they add sources. id breaks ties
    // because rows created in one transaction can share created_at to the microsecond, and an
    // unstable order in a list with Rename/Disable buttons is how the wrong row gets clicked.
    .orderBy(asc(qrCodes.createdAt), asc(qrCodes.id))
    .limit(MAX_SOURCES);

  const baseUrl = env().APP_BASE_URL;

  return NextResponse.json({
    sources: rows.map((row) => ({
      id: row.id,
      code: row.code,
      // Wire names mirror qrSourceRequest in @ai-review/contracts, so what QR-01 sends when it
      // creates or renames a source is exactly what it reads back.
      source_label: row.sourceLabel,
      internal_note: row.internalNote,
      status: row.status,
      // A UTC instant. Rendering it in businesses.timezone (AMENDMENT-004) is the client's job —
      // AC-026 governs date *filters* on analytics, not the transport format of a timestamp.
      created_at: row.createdAt.toISOString(),
      // What the standee actually encodes (ADR-002, D-026): the opaque dynamic URL, never the
      // Google URL and never the slug. Surfaced so the owner can check a printed code by hand and
      // so support can be given a link that resolves the same way a scan does.
      resolve_url: buildQrUrl(baseUrl, row.code),
      // QR-01 also lists "Destination behavior fixed to AI review V1" as screen content. It is not
      // returned here because nothing backs it: there is one destination behaviour in V1 and no
      // column that could ever hold a second value, so it is a fixed label the screen renders. An
      // API field would imply a choice the product does not have.
    })),
  });
}

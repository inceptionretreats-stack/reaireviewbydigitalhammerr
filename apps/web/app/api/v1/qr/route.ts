import { NextResponse, type NextRequest } from 'next/server';
import { asc, count, eq } from 'drizzle-orm';
import { analyticsEvents, qrCodes } from '@ai-review/db';
import type { EventPayload } from '@ai-review/analytics';
import { buildQrUrl, generateQrCode } from '@ai-review/core';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { apiError } from '@/lib/api-error';
import { requireActiveTenant, requireTenant } from '@/lib/require-tenant';
import { qrDataUri } from '@/lib/qr-image';
import {
  MAX_SOURCES_PER_BUSINESS,
  parseQrSourceCreate,
  toQrSourceWire,
  type QrSourceCreate,
  type QrSourceRow,
} from './qr-source';
import { recordActivity } from '@/lib/activity';

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

/*
 * A tenant has a handful of standees, so QR-01 specifies no pagination and `/qr` declares none in
 * 08_OpenAPI_v1.yaml. The SELECT below is still capped, but with `MAX_SOURCES_PER_BUSINESS` — the
 * same constant POST enforces on create — rather than a second literal. One definition is what
 * makes the two agree: a list cap below the create cap would hide a source the owner has paid for
 * a standee for and can no longer see or disable, which is exactly the failure that constant's own
 * comment describes. A tenant that ever reaches it needs real pagination, not a larger number.
 */

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
    .limit(MAX_SOURCES_PER_BUSINESS);

  const baseUrl = env().APP_BASE_URL;

  // Encoded per row rather than fetched per row: the screen shows every code as a thumbnail, and
  // an <img> per source pointing at the download endpoint would be one authenticated request
  // each. A QR encode is a few hundred microseconds and the list is capped at
  // MAX_SOURCES_PER_BUSINESS, so this stays a bounded cost.
  const sources = await Promise.all(
    rows.map(async (row) => ({
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
      preview_src: await qrDataUri(buildQrUrl(baseUrl, row.code)),
      // QR-01 also lists "Destination behavior fixed to AI review V1" as screen content. It is not
      // returned here because nothing backs it: there is one destination behaviour in V1 and no
      // column that could ever hold a second value, so it is a fixed label the screen renders. An
      // API field would imply a choice the product does not have.
    })),
  );

  return NextResponse.json({ sources });
}

/**
 * POST /api/v1/qr — the `create` state of QR-01.
 *
 * Gated on `requireActiveTenant`, which refuses both a suspended and a DRAFT tenant. Flow J covers
 * the first: a suspended business must not be able to mutate its configuration. The second is an
 * interpretation worth stating, because QR-01 does not mention draft — publish is what creates the
 * first source (ONB-05-01), and a code created before publish would resolve to the unavailable
 * page, so a standee printed from it would be waste. `/app/qr` says so rather than offering a
 * button that 409s.
 *
 * The response carries the created source in the same shape `GET` returns, so QR-01 can append it
 * to its list without a refetch.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireTenant(request);
  if (!auth.ok) return auth.response;

  const inactive = requireActiveTenant(auth.context);
  if (inactive) return inactive;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return apiError('VALIDATION_FAILED', 'Malformed request body.');
  }

  const parsed = parseQrSourceCreate(raw);
  if (!parsed.ok) {
    return apiError('VALIDATION_FAILED', parsed.message, {
      ...(parsed.fields.length > 0 ? { details: { fields: parsed.fields } } : {}),
    });
  }

  const database = db();
  const { businessId } = auth.context;

  const [existing] = await database
    .select({ sources: count() })
    .from(qrCodes)
    .where(eq(qrCodes.businessId, businessId));

  // Counted rather than trusted, and deliberately not atomic with the insert below: a tenant
  // racing itself could end up one or two sources over. That is harmless for a sanity ceiling —
  // what it protects against is a script creating rows without limit, not an off-by-one.
  if ((existing?.sources ?? 0) >= MAX_SOURCES_PER_BUSINESS) {
    return apiError(
      'VALIDATION_FAILED',
      `You already have ${MAX_SOURCES_PER_BUSINESS} QR sources, which is the most we support. ` +
        'Disable one you no longer print rather than adding another.',
      { details: { limit: MAX_SOURCES_PER_BUSINESS } },
    );
  }

  const created = await reserveSource(database, businessId, parsed.value);

  if (!created) {
    // Reported through the envelope rather than thrown. `POST /business/publish` throws in the
    // equivalent case, and the framework's error page is then the body — the one failure in the
    // API that does not answer in the shape of 23_API_Error_Codes.md.
    console.error('[qr-create] could not reserve a unique code', { businessId });
    return apiError('INTERNAL_ERROR', 'We could not create that QR code. Please try again.');
  }

  await recordCreated(database, businessId, created);

  recordActivity(
    request,
    { session: auth.context.session, businessId },
    {
      action: 'qr.create',
      targetType: 'qr_code',
      targetId: created.id,
      metadata: { source_label: created.sourceLabel },
    },
  );
  return NextResponse.json(
    {
      source: toQrSourceWire(
        created,
        buildQrUrl(env().APP_BASE_URL, created.code),
        await qrDataUri(buildQrUrl(env().APP_BASE_URL, created.code)),
      ),
    },
    { status: 201 },
  );
}

/**
 * Inserts a source with a fresh opaque code, retrying on collision.
 *
 * The code space is about 8.2e14, so a collision is vanishingly unlikely — but `code` is UNIQUE and
 * the consequence of one would be a printed standee resolving to another business's page, so
 * "vanishingly unlikely" is not the same as handled.
 *
 * Each attempt is its own statement, outside any transaction, which is what makes the retry work:
 * a unique violation inside a transaction leaves it aborted, so every later statement fails with
 * 25P02 until a rollback. Nothing else here needs to be atomic with the insert.
 */
async function reserveSource(
  database: ReturnType<typeof db>,
  businessId: string,
  input: QrSourceCreate,
): Promise<QrSourceRow | null> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const [created] = await database
        .insert(qrCodes)
        .values({
          businessId,
          code: generateQrCode(),
          sourceLabel: input.sourceLabel,
          internalNote: input.internalNote,
          // Explicit, though the column defaults to it: a source is created enabled because the
          // owner is about to print it.
          status: 'ACTIVE',
        })
        .returning({
          id: qrCodes.id,
          code: qrCodes.code,
          sourceLabel: qrCodes.sourceLabel,
          internalNote: qrCodes.internalNote,
          status: qrCodes.status,
          createdAt: qrCodes.createdAt,
        });

      if (created) return created;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }
  return null;
}

/**
 * `qr_created` (11_Analytics_Event_Taxonomy.csv, actor Business).
 *
 * Typed as `EventPayload<'qr_created'>` so the property set is checked against the taxonomy at
 * compile time — omitting a required property or inventing one is a build error, which is what
 * makes AN-01-01 structural rather than a review note.
 *
 * Swallowed on failure: the source exists and its artwork is downloadable, so a degraded analytics
 * pipeline must not turn a successful create into an error the owner sees (the same rule AC-035
 * applies to the customer flow).
 */
async function recordCreated(
  database: ReturnType<typeof db>,
  businessId: string,
  created: QrSourceRow,
): Promise<void> {
  const properties: EventPayload<'qr_created'> = {
    business_id: businessId,
    qr_code_id: created.id,
    source_label: created.sourceLabel,
  };

  try {
    await database.insert(analyticsEvents).values({
      businessId,
      qrCodeId: created.id,
      eventName: 'qr_created',
      properties,
    });
  } catch (error) {
    console.warn('[analytics] qr_created failed', error);
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

import { NextResponse, type NextRequest } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { qrCodes } from '@ai-review/db';
import { buildQrUrl } from '@ai-review/core';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { apiError } from '@/lib/api-error';
import { requireTenant } from '@/lib/require-tenant';
import { renderQrPng, renderQrSvg } from '@/lib/qr-image';
import { contentDisposition, parseFormat, type QrFormat } from './filename';

/**
 * GET /api/v1/qr/{id}/download?format=svg|png — the Download SVG / Download PNG actions of QR-01.
 *
 * Both formats render synchronously. 02_System_Architecture.md permits PNG export to be
 * asynchronous, and the reason to allow that is the usual assumption that rasterising needs a
 * canvas. It does not here: `qrcode` rasterises through pngjs, which is pure JavaScript, so a PNG
 * costs one bounded encode of a server-fixed image and adds no native dependency, no object-storage
 * round trip and no job queue. Deferring it would mean QR-01's "Download PNG" button handing back a
 * job id and a polling state, which is a worse screen for no gain at this scale. The escape hatch
 * stays open if the render ever becomes a load problem — move it to the worker and write to object
 * storage, which 02_System_Architecture.md already names as the home for "exported QR assets".
 *
 * Node runtime is declared explicitly because pngjs needs Buffer and zlib. It is the Next default
 * today; stating it means a future global edge default cannot silently break PNG at runtime.
 */
export const runtime = 'nodejs';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RenderedImage {
  body: string | Uint8Array<ArrayBuffer>;
  contentType: string;
  format: QrFormat;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireTenant(request);
  if (!auth.ok) return auth.response;

  const format = parseFormat(new URL(request.url).searchParams.get('format'));
  if (!format) {
    return apiError('VALIDATION_FAILED', 'Choose either the SVG or the PNG format.', {
      details: { fields: ['format'] },
    });
  }

  const { id } = await params;

  // Checked before the query rather than trusted into it: an id that is not a uuid makes Postgres
  // raise 22P02, which would surface as a 500 for what is plainly a request for something that
  // does not exist.
  if (!UUID_PATTERN.test(id)) return notFound();

  const [source] = await db()
    .select({ code: qrCodes.code, sourceLabel: qrCodes.sourceLabel })
    .from(qrCodes)
    // Ownership is part of the WHERE clause, not a check on the returned row. An id in a URL is
    // exactly the IDOR shape AC-003 tests for, and a QR code is a locator rather than an
    // authorization token (RBAC rule 3) — so the query cannot read another tenant's row at all,
    // and no fetched-then-forgotten branch is left for a later edit to get wrong.
    .where(and(eq(qrCodes.id, id), eq(qrCodes.businessId, auth.context.businessId)))
    .limit(1);

  // RESOURCE_NOT_FOUND — "absent/inaccessible" in 23_API_Error_Codes.md — answers both "no such
  // row" and "not yours" identically, which is what stops this endpoint being an existence oracle
  // for other tenants' ids. QR_NOT_FOUND stays reserved for public /r/{code} resolution, where the
  // subject genuinely is an unknown code.
  if (!source) return notFound();

  // status is deliberately not read. A DISABLED source still yields its artwork: the printed
  // artefact is permanent and the configuration around it is what changes (D-026), so refusing to
  // hand back the image for a standee that happens to be paused today inverts that relationship.
  // QR-01 shows status in the list and Enable is one click away, so the owner is not misled.

  // ADR-002 and D-026: the encoded payload is the opaque dynamic URL and nothing else — never the
  // Google review URL, never the slug, never a custom domain. That single indirection is the whole
  // reason a printed standee survives every later change of destination, web address or domain
  // (AC-017), and encoding anything else here would quietly undo it.
  const payload = buildQrUrl(env().APP_BASE_URL, source.code);

  let rendered: RenderedImage;
  try {
    rendered = format === 'svg' ? await renderSvg(payload) : await renderPng(payload);
  } catch (error) {
    // The payload is a short ASCII URL that always fits inside a version-6 symbol, so a failure
    // here is an environment problem rather than bad input. Logged in full, reported generically:
    // AC-030 forbids library internals and stack traces reaching a client.
    console.error('[qr-download] render failed', { format, code: source.code, error });
    return apiError('INTERNAL_ERROR', 'We could not prepare that QR image. Please try again.');
  }

  return imageResponse(rendered, source.sourceLabel, source.code);
}

async function renderSvg(payload: string): Promise<RenderedImage> {
  const svg = await renderQrSvg(payload);
  return { body: svg, contentType: 'image/svg+xml; charset=utf-8', format: 'svg' };
}

async function renderPng(payload: string): Promise<RenderedImage> {
  const png = await renderQrPng(payload);
  return { body: toResponseBody(png), contentType: 'image/png', format: 'png' };
}

/**
 * Copies the buffer into a Uint8Array backed by a plain ArrayBuffer.
 *
 * Node's Buffer is a Uint8Array<ArrayBufferLike>, which does not satisfy the BodyInit types a
 * Response expects under strict TypeScript. A few kilobytes of copying buys an exact type instead
 * of a cast that would suppress a real variance rule.
 */
function toResponseBody(buffer: Buffer): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(buffer.byteLength);
  bytes.set(buffer);
  return bytes;
}

function imageResponse(rendered: RenderedImage, sourceLabel: string, code: string): NextResponse {
  return new NextResponse(rendered.body, {
    status: 200,
    headers: {
      'Content-Type': rendered.contentType,
      'Content-Disposition': contentDisposition(sourceLabel, code, rendered.format),
      // attachment plus nosniff, because an SVG served inline from our own origin is a script
      // execution context. Nothing here interpolates tenant input into the document — the label
      // travels in the header, not the image — but a file-download endpoint should not be the one
      // place whose safety depends on that staying true.
      'X-Content-Type-Options': 'nosniff',
      // Private and short. The artwork is stable for the life of the row because the code is
      // immutable (QR-01-01), but the encoded host comes from APP_BASE_URL, a deploy-time input —
      // long enough to absorb a double-click, short enough never to outlive a base-URL change.
      'Cache-Control': 'private, max-age=300',
    },
  });
}

function notFound(): NextResponse {
  return apiError('RESOURCE_NOT_FOUND', 'We could not find that QR code.');
}

import { NextResponse, type NextRequest } from 'next/server';
import { and, eq } from 'drizzle-orm';
import * as QRCode from 'qrcode';
import { qrCodes } from '@ai-review/db';
import { buildQrUrl } from '@ai-review/core';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { apiError } from '@/lib/api-error';
import { requireTenant } from '@/lib/require-tenant';

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

const FORMATS = ['svg', 'png'] as const;
type QrFormat = (typeof FORMATS)[number];

/**
 * Error-correction level H recovers ~30% of a damaged symbol, against ~25% for Q.
 *
 * A QR on a shop counter gets scuffed, wiped and taped over, and the correction level is what
 * decides whether it still scans after that. H costs four extra modules per side for this payload
 * (41x41 rather than 37x37) — roughly 10% smaller modules at a fixed print size, which is not a
 * material change to scan distance at standee size. Trading a little optical margin for a lot of
 * damage tolerance is the right way round for a printed asset that cannot be reprinted cheaply.
 */
const ERROR_CORRECTION = 'H';

/**
 * The four-module quiet zone required by ISO/IEC 18004. It is not decoration: without it a scanner
 * has nothing to lock the symbol's edges against, and a QR bled to the edge of printed artwork is
 * one of the commonest reasons a code that looks fine does not scan.
 */
const QUIET_ZONE_MODULES = 4;

/**
 * A server-fixed size — the client cannot ask for a larger one, so no single request can be turned
 * into an expensive raster (pngjs cost grows with the pixel count). At 300 DPI this prints ~87mm
 * square, a correct counter-standee QR. Anything larger should use the SVG, which is
 * resolution-independent and is the reason the vector format is offered at all.
 */
const IMAGE_WIDTH_PX = 1024;

/**
 * Pure black on pure white, never the tenant's brand accent. Maximum luminance contrast is what a
 * scanner thresholds against, and a printed QR has no second channel to fall back on — the same
 * "never rely on colour alone" principle as AC-038, applied to a machine reader. The explicit
 * opaque white matters too: a transparent quiet zone would let a coloured standee background show
 * through and destroy the very margin QUIET_ZONE_MODULES reserves.
 */
const PRINT_COLORS = { dark: '#000000', light: '#ffffff' } as const;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Illegal in a filename on Windows, and `/` and `\` are path separators everywhere. */
const RESERVED_FILENAME_CHARS = new Set(['/', '\\', ':', '*', '?', '"', '<', '>', '|']);

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
  // `width` is honoured alongside the viewBox, so the file still scales losslessly but opens at a
  // sensible size instead of 41 pixels across when the owner double-clicks it.
  const svg = await QRCode.toString(payload, {
    type: 'svg',
    errorCorrectionLevel: ERROR_CORRECTION,
    margin: QUIET_ZONE_MODULES,
    width: IMAGE_WIDTH_PX,
    color: PRINT_COLORS,
  });

  return { body: svg, contentType: 'image/svg+xml; charset=utf-8', format: 'svg' };
}

async function renderPng(payload: string): Promise<RenderedImage> {
  const png = await QRCode.toBuffer(payload, {
    type: 'png',
    errorCorrectionLevel: ERROR_CORRECTION,
    margin: QUIET_ZONE_MODULES,
    width: IMAGE_WIDTH_PX,
    color: PRINT_COLORS,
  });

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

/**
 * 08_OpenAPI_v1.yaml declares format as svg|png with svg as the default, so an absent parameter is
 * valid and means svg rather than being an error.
 */
function parseFormat(raw: string | null): QrFormat | null {
  if (raw === null || raw.trim() === '') return 'svg';

  const normalized = raw.trim().toLowerCase();
  for (const format of FORMATS) {
    if (format === normalized) return format;
  }
  return null;
}

function notFound(): NextResponse {
  return apiError('RESOURCE_NOT_FOUND', 'We could not find that QR code.');
}

/**
 * RFC 6266 Content-Disposition carrying both filename forms.
 *
 * The ASCII `filename` is built by allowlist — everything outside [A-Za-z0-9] collapses to a
 * hyphen — rather than by stripping characters known to be dangerous. That is what makes
 * quoted-string escape and header injection impossible by construction instead of by enumeration:
 * a source label containing a quote, a backslash or a CRLF cannot produce one in the header.
 *
 * `filename*` carries the real label so a Devanagari or Tamil source label arrives intact rather
 * than as a row of hyphens, which matters for an India-first product. The opaque code is appended
 * to both forms: two standees both labelled "Counter" stay distinguishable on disk, a printed file
 * can be matched back to the source label that appears in analytics (QR-01 acceptance note), and
 * the suffix incidentally means the stem can never equal a Windows reserved device name — a label
 * of "NUL" yields "NUL-ABCDEFGHJK", which is an ordinary filename.
 */
function contentDisposition(sourceLabel: string, code: string, format: QrFormat): string {
  const label = filenameLabel(sourceLabel);
  const ascii = `${asciiStem(label, code)}.${format}`;
  const encoded = encodeRfc5987(`${label}-${code}.${format}`);

  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

function asciiStem(label: string, code: string): string {
  const stem = label
    // NFKD followed by dropping combining marks turns "Café" into "Cafe" rather than "Caf-".
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    // Truncate before the final trim, so a hyphen landing on the cut is not left dangling.
    .slice(0, 40)
    .replace(/^-+|-+$/g, '');

  // A label with nothing ASCII-representable in it at all — a wholly Devanagari or Tamil one — is
  // a normal case here, not an error. The real name still travels in filename*.
  return stem.length > 0 ? `${stem}-${code}` : `qr-${code}`;
}

/**
 * Reduces the label to something that is a legal filename on Windows, macOS and Linux alike.
 *
 * Control characters, path separators and the characters Windows reserves (: * ? " < > |) all
 * become spaces, and leading or trailing dots are dropped. Two of those go beyond tidiness:
 * removing path separators and any leading ".." means a label can never contribute a traversal
 * segment to `filename*`, even though RFC 6266 makes stripping path information the recipient's
 * job — and Windows is the realistic download target for a merchant sending artwork to a printer.
 *
 * Iterating by code point rather than by code unit also guarantees a surrogate pair is never
 * split, which is what would otherwise make encodeURIComponent throw on a lone surrogate.
 */
function filenameLabel(value: string): string {
  let out = '';
  for (const char of value) {
    const point = char.codePointAt(0) ?? 0;
    const isControl = point < 0x20 || (point >= 0x7f && point <= 0x9f);
    out += isControl || RESERVED_FILENAME_CHARS.has(char) ? ' ' : char;
  }

  // Leading and trailing dots and spaces go in one pass each, as a single run. Stripping dots and
  // whitespace in separate passes is not equivalent: "../../etc/passwd" becomes ".. .. etc passwd"
  // once the separators are spaced out, and one leading-dot strip then leaves ".. etc passwd".
  const cleaned = out
    .replace(/\s+/gu, ' ')
    .replace(/^[.\s]+/u, '')
    .replace(/[.\s]+$/u, '');

  // Empty is reachable rather than exceptional: source_label need only be one character long, and
  // that character may be a space or a dot.
  return cleaned.length > 0 ? cleaned : 'qr';
}

/**
 * RFC 5987 attr-char is a narrower set than encodeURIComponent leaves unescaped, so the four
 * characters it permits and the RFC does not — apostrophe, parentheses and asterisk — are escaped
 * by hand.
 */
function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

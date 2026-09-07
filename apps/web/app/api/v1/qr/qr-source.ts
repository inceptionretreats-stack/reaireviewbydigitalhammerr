import { qrSourceRequest } from '@ai-review/contracts';
import type { QrCode } from '@ai-review/db';

/**
 * Request parsing and the wire shape shared by the QR-01 write endpoints — POST /api/v1/qr and
 * PATCH /api/v1/qr/{id}.
 *
 * It lives beside the handlers rather than in `apps/web/lib/` for two reasons. The first is that
 * both handlers must answer with *the same* object the list endpoint returns, so QR-01 can drop
 * the response straight into its list without a second fetch; one definition is what keeps the
 * three in step. The second is testability: nothing here imports `next/server`, `@ai-review/db`'s
 * runtime (the `QrCode` import is type-only and erased) or `@ai-review/core`, so the validation
 * rules can be exercised as plain functions instead of through a route.
 *
 * `resolve_url` is passed in rather than built here for the same reason — `buildQrUrl` comes from
 * `@ai-review/core`, whose root entry point pulls in pg, ioredis and argon2.
 */

/** `qr_status` (packages/db/src/schema/enums.ts), derived so it cannot drift from the column. */
export type QrStatus = QrCode['status'];

/**
 * Exhaustive over the enum by construction: adding a third `qr_status` value fails to compile
 * here rather than being silently rejected by PATCH as an unrecognised word.
 */
const QR_STATUSES: Record<QrStatus, true> = { ACTIVE: true, DISABLED: true };

export function isQrStatus(value: unknown): value is QrStatus {
  // hasOwn rather than `in`, so 'constructor' or '__proto__' cannot answer true.
  return typeof value === 'string' && Object.hasOwn(QR_STATUSES, value);
}

/**
 * A sanity ceiling on sources per tenant, and the cap `GET /api/v1/qr` and `/app/qr` apply to
 * their SELECT.
 *
 * One definition on purpose: a list cap below the create cap would leave a 501st source as a row
 * the owner has paid for a standee for and can no longer see or disable. If a real tenant ever
 * needs more, `/qr` needs pagination — not a larger number here.
 */
export const MAX_SOURCES_PER_BUSINESS = 500;

export interface QrSourceCreate {
  sourceLabel: string;
  internalNote: string | null;
}

/**
 * A rename, an enable/disable, or both (QR-01 lists Rename, Disable and Enable as separate
 * actions against one endpoint).
 *
 * Every member is optional because PATCH is a partial update, and the difference between absent
 * and present matters for the note: absent leaves the stored note alone, while present-and-blank
 * clears it. `null` therefore means "clear", not "unchanged".
 */
export interface QrSourcePatch {
  sourceLabel?: string;
  internalNote?: string | null;
  status?: QrStatus;
}

export type ParseResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      /** Safe to show a client verbatim (AC-030): no field values, no provider detail. */
      message: string;
      /** Field names for the client to mark invalid, in the `details.fields` convention. */
      fields: string[];
    };

/**
 * The label and note halves of a partial update, with the constraints from
 * `qrSourceRequest` (packages/contracts) still doing the work.
 *
 * Built once at module scope: `.partial()` constructs a new schema, and doing that per request
 * would rebuild it on every rename.
 */
const qrSourceTextPatch = qrSourceRequest.partial();

/** POST /api/v1/qr — `qrSourceRequest` is the authority on both fields. */
export function parseQrSourceCreate(raw: unknown): ParseResult<QrSourceCreate> {
  const body = trimTextFields(raw);

  // `z.string().min(1)` accepts a single space, and a whitespace label is not a label: QR-01-03
  // makes this string the attribution key in analytics, and the download handler already has to
  // substitute "qr" for it when building a filename. Answered before the contract sees it, because
  // a label trimmed to nothing fails `min(1)` as a generic "check the details" — this branch is
  // what says out loud what a source label is for.
  if (body?.source_label === '') return blankLabel();

  const parsed = qrSourceRequest.safeParse(body ?? raw);
  if (!parsed.success) {
    return {
      ok: false,
      message: 'Please check the details you entered.',
      fields: [...new Set(parsed.error.issues.map((issue) => String(issue.path[0] ?? 'body')))],
    };
  }

  return {
    ok: true,
    // Already trimmed by `trimTextFields`, which is also what the length limit was measured
    // against — the stored value and the validated value are the same string.
    value: {
      sourceLabel: parsed.data.source_label,
      internalNote: normalizeNote(parsed.data.internal_note),
    },
  };
}

/** PATCH /api/v1/qr/{id} — rename, enable, disable, or a rename and a status change together. */
export function parseQrSourcePatch(raw: unknown): ParseResult<QrSourcePatch> {
  // Null for anything that is not a JSON object; otherwise a copy with the text fields trimmed,
  // which is what the length limits are then measured against.
  const body = trimTextFields(raw);
  if (body === null) {
    return { ok: false, message: 'Malformed request body.', fields: [] };
  }

  /*
   * QR-01-01: the opaque code is immutable for the life of the row, because a printed standee
   * cannot be recalled. Zod would strip an unknown `code` key silently, and a client that sent
   * one would get a 200 back and reasonably believe the code had changed. Refused explicitly, so
   * the answer says what is actually true.
   */
  if ('code' in body || 'id' in body) {
    return {
      ok: false,
      message:
        'A QR code is permanent and cannot be changed. Renaming the label does not affect the ' +
        'printed code.',
      fields: ['code'],
    };
  }

  // As in `parseQrSourceCreate`: a rename trimmed to nothing has to keep the message that says
  // what a label is for, rather than falling through `min(1)` to the generic one.
  if (body.source_label === '') return blankLabel();

  const parsed = qrSourceTextPatch.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      message: 'Please check the details you entered.',
      fields: [...new Set(parsed.error.issues.map((issue) => String(issue.path[0] ?? 'body')))],
    };
  }

  const patch: QrSourcePatch = {};

  if (parsed.data.source_label !== undefined) {
    // Trimmed and non-blank by the two checks above.
    patch.sourceLabel = parsed.data.source_label;
  }

  // Presence, not truthiness: an empty string is how the client clears a note, and treating it
  // as absent would make the note un-clearable once set.
  if ('internal_note' in body) {
    patch.internalNote = normalizeNote(parsed.data.internal_note);
  }

  /*
   * Validated by hand rather than in the contract, because `qrSourceRequest` carries no status
   * field and `packages/contracts` is not this module's to change (see concerns). The vocabulary
   * is still derived from the database enum through `isQrStatus`, so it cannot drift.
   */
  if ('status' in body) {
    if (!isQrStatus(body.status)) {
      return {
        ok: false,
        message: 'A QR source can only be enabled or disabled.',
        fields: ['status'],
      };
    }
    patch.status = body.status;
  }

  if (Object.keys(patch).length === 0) {
    return { ok: false, message: 'There was nothing to change.', fields: [] };
  }

  return { ok: true, value: patch };
}

/**
 * A row as QR-01 reads it. Field names mirror `GET /api/v1/qr` exactly, so a created or renamed
 * source can replace a list entry without the screen learning two shapes.
 */
export interface QrSourceWire {
  id: string;
  code: string;
  source_label: string;
  internal_note: string | null;
  status: QrStatus;
  created_at: string;
  resolve_url: string;
}

export interface QrSourceRow {
  id: string;
  code: string;
  sourceLabel: string;
  internalNote: string | null;
  status: QrStatus;
  createdAt: Date;
}

export function toQrSourceWire(row: QrSourceRow, resolveUrl: string): QrSourceWire {
  return {
    id: row.id,
    code: row.code,
    source_label: row.sourceLabel,
    internal_note: row.internalNote,
    status: row.status,
    // A UTC instant; rendering it in businesses.timezone (AMENDMENT-004) is the client's job.
    created_at: row.createdAt.toISOString(),
    // ADR-002, D-026: the opaque dynamic URL is what the standee encodes — never the Google URL
    // and never the slug, which is the whole reason a printed code survives a change of either.
    resolve_url: resolveUrl,
  };
}

/**
 * Whether a path segment can be a `qr_codes.id` at all.
 *
 * Checked before the query rather than trusted into it: a non-uuid makes Postgres raise 22P02,
 * which would surface as a 500 for what is plainly a request for something that does not exist.
 * `[id]/download/route.ts` carries its own copy of this pattern, written before this module
 * existed; that file belongs to another workstream and is not merged here.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isQrSourceId(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/**
 * A shallow copy of a JSON object body with the two free-text fields trimmed, or null for anything
 * that is not a JSON object at all.
 *
 * Both sides of a write have to measure the same string. QR-01's dialog checks the label with
 * `labelError` (components/dashboard/qr/qr-sources.ts), which trims first, so a 120-character
 * label pasted with a trailing space passed the client check and then failed `z.string().max(120)`
 * here at 121 or more — a generic 422 for a label that is, once stored, exactly the width the
 * column allows. Trimming before the contract measures makes the validated value and the stored
 * value the same string.
 *
 * A copy rather than a mutation, so parsing a request body never edits the caller's object. Values
 * that are not strings are left alone for the contract to reject.
 */
function trimTextFields(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;

  const body: Record<string, unknown> = { ...raw };
  for (const key of ['source_label', 'internal_note'] as const) {
    const value = body[key];
    if (typeof value === 'string') body[key] = value.trim();
  }
  return body;
}

/** An empty box means "no note", which is stored as NULL rather than as an empty string. */
function normalizeNote(value: string | undefined): string | null {
  const note = value?.trim() ?? '';
  return note === '' ? null : note;
}

function blankLabel(): ParseResult<never> {
  return {
    ok: false,
    message: 'Give this QR a source label, such as Reception or Billing Counter.',
    fields: ['source_label'],
  };
}

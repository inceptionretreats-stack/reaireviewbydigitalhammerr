import type { QrCode } from '@ai-review/db';
import type { LifecycleStatus } from '@ai-review/ui';
import { formatDate } from '@/lib/dashboard/presentation';

/**
 * The data and rules QR-01 renders, separated from the components that render them.
 *
 * Everything here is a pure function so it can be tested without a DOM: the unit suite runs in
 * Node (`vitest.config.mts`), which is also why this file is `.ts` and carries no JSX. The
 * `@ai-review/db` and `@ai-review/ui` imports are type-only and erased, so nothing server-side is
 * dragged into the browser bundle or into a test.
 */

/** `qr_status`, derived from the schema so a third state cannot appear here unhandled. */
export type QrStatus = QrCode['status'];

/**
 * One QR source as the screen holds it.
 *
 * `createdAt` stays the ISO string the API returns rather than a `Date`, because this object
 * crosses the Server Component boundary as props and a `Date` would be serialised anyway.
 */
export interface QrSource {
  id: string;
  /** Immutable for the life of the row (QR-01-01). Nothing in the UI offers to change it. */
  code: string;
  label: string;
  note: string | null;
  status: QrStatus;
  createdAt: string;
  /** The opaque `/r/{code}` URL the standee encodes (ADR-002, D-026). */
  resolveUrl: string;
  /** The rendered symbol as a data URI, so an owner sees the code and not just its name. */
  previewSrc: string;
}

/**
 * Mirrors `qrSourceRequest` in `@ai-review/contracts`, which is authoritative and is what actually
 * gates a save. These only stop an owner typing 900 characters and then being told to cut them.
 */
export const LABEL_MAX = 120;
export const NOTE_MAX = 500;

/**
 * Starter labels offered on the empty state and in the create form.
 *
 * QR-01-03 is the reason they are here at all: the source label is what makes attribution readable
 * in analytics later, and an owner who names their first two sources "QR 1" and "QR 2" has thrown
 * that away before any data exists. Reception and Billing Counter are the pack's own examples
 * (`24_Glossary.md`, `20_Test_Data_Seed.json`); Packaging covers a delivery or takeaway source and
 * came from the module brief rather than the frozen pack.
 */
export const EXAMPLE_LABELS: readonly string[] = ['Reception', 'Billing Counter', 'Packaging'];

interface QrStatusPresentation {
  /** Badge family from `18_UI_UX_Design_System_Brief.md`: Active / Pending / Disabled. */
  badge: LifecycleStatus;
  label: string;
  /** The action that changes it, as the button says it. */
  action: 'Disable' | 'Enable';
  nextStatus: QrStatus;
}

/**
 * A `Record` over the enum rather than a switch: adding a `qr_status` value becomes a compile
 * error here instead of an unlabelled badge.
 *
 * The sentence each state gets is not here but in `describeQrScan`, because what a scan does
 * depends on the tenant as well as the row.
 */
const QR_STATUS: Record<QrStatus, QrStatusPresentation> = {
  ACTIVE: {
    badge: 'ACTIVE',
    label: 'Active',
    action: 'Disable',
    nextStatus: 'DISABLED',
  },
  DISABLED: {
    badge: 'DISABLED',
    label: 'Disabled',
    action: 'Enable',
    nextStatus: 'ACTIVE',
  },
};

export function describeQrStatus(status: QrStatus): QrStatusPresentation {
  return QR_STATUS[status];
}

/**
 * What a customer standing in front of this standee actually gets — the row's status *and* the
 * tenant's, because the row alone does not decide it.
 *
 * `loadPublicConfig` (apps/web/lib/customer/public-business.ts) returns nothing unless `businesses.status`
 * is ACTIVE, so for a SUSPENDED or CLOSED tenant `resolveByQrCode` answers BUSINESS_NOT_ACTIVE and
 * `/r/{code}` renders "This review page is not available at the moment." Telling those owners that
 * an enabled code "opens your review page" would be false, and would contradict the banner directly
 * above the table, which says their public page is unavailable — the same screen saying both.
 *
 * The live DISABLED sentence is the one that matters most in the other direction: `/r/{code}`
 * answers a disabled code with a controlled "not available" page rather than a 404 (QR-01-02), and
 * the printed code keeps working the moment it is enabled again. An owner who does not know that
 * throws a standee away instead of pausing it.
 */
export function describeQrScan(status: QrStatus, isPubliclyLive: boolean): string {
  if (!isPubliclyLive) {
    return status === 'ACTIVE'
      ? 'This code is enabled, but your public page is unavailable right now, so scanning it ' +
          'shows a short "not available" message.'
      : 'Scanning it shows a short "not available" message — this code is disabled, and your ' +
          'public page is unavailable right now as well.';
  }

  return status === 'ACTIVE'
    ? 'Scanning it opens your review page.'
    : 'Scanning it shows a short "not available" message. Enable it to switch it back on.';
}

/** hasOwn rather than `in`, so 'toString' cannot answer true for a status. */
function isQrStatus(value: unknown): value is QrStatus {
  return typeof value === 'string' && Object.hasOwn(QR_STATUS, value);
}

export interface QrSourceCounts {
  total: number;
  active: number;
  disabled: number;
}

export function countSources(sources: readonly QrSource[]): QrSourceCounts {
  let active = 0;
  for (const source of sources) {
    if (source.status === 'ACTIVE') active += 1;
  }
  return { total: sources.length, active, disabled: sources.length - active };
}

/**
 * The count line under the card title.
 *
 * Disabled sources are named separately rather than folded into a total, because a disabled code is
 * still a standee on a counter somewhere (QR-01-02). An owner reading "4 sources" while one of them
 * shows customers an unavailable page has been told the wrong thing.
 */
export function describeCounts(counts: QrSourceCounts): string {
  if (counts.total === 0) return 'No QR sources yet.';

  const only = counts.total === 1;
  const sources = only ? '1 source' : `${counts.total} sources`;

  if (counts.disabled === 0) return only ? '1 source, active.' : `${sources}, all active.`;
  if (counts.disabled === counts.total) {
    return only ? '1 source, disabled.' : `${sources}, all disabled.`;
  }
  return `${sources}, ${counts.disabled} of them disabled.`;
}

/**
 * Puts a created or updated source into the list.
 *
 * A rename or a status change replaces the row in place, because the list is ordered oldest-first
 * (`GET /api/v1/qr`) and a row that jumped to the bottom the moment it was renamed is how the
 * wrong standee gets disabled next. A source the list has not seen is new, so it goes last, which
 * is where that same ordering puts it.
 */
export function upsertSource(sources: readonly QrSource[], source: QrSource): QrSource[] {
  const index = sources.findIndex((candidate) => candidate.id === source.id);
  if (index === -1) return [...sources, source];

  const next = [...sources];
  next[index] = source;
  return next;
}

/**
 * Reads one source out of an API response.
 *
 * Defensive rather than cast, because this is the one place the screen's own state is built from a
 * network payload: a field that arrives missing or of the wrong type must leave the list untouched
 * and be reported, not render as `undefined` in a table cell.
 */
export function parseQrSource(raw: unknown): QrSource | null {
  // Both write endpoints answer `{ source: {...} }`; a bare source object is accepted too, so a
  // caller that has already unwrapped the envelope is not a special case.
  const row = readObject(readObject(raw)?.source ?? raw);
  if (!row) return null;

  const id = readNonEmptyString(row.id);
  const code = readNonEmptyString(row.code);
  const label = readNonEmptyString(row.source_label);
  const createdAt = readNonEmptyString(row.created_at);
  const resolveUrl = readNonEmptyString(row.resolve_url);
  const previewSrc = readNonEmptyString(row.preview_src);

  if (!id || !code || !label || !createdAt || !resolveUrl || !previewSrc) return null;
  if (!isQrStatus(row.status)) return null;

  return {
    id,
    code,
    label,
    note: typeof row.internal_note === 'string' ? row.internal_note : null,
    status: row.status,
    createdAt,
    resolveUrl,
    previewSrc,
  };
}

export interface QrFailure {
  code: string;
  /** Already safe to show verbatim: the API only ever returns user-facing messages (AC-030). */
  message: string;
  /** Field names from `details.fields`, so the form can mark the right input invalid. */
  fields: string[];
}

/**
 * Unpacks the error envelope from `23_API_Error_Codes.md`.
 *
 * This repeats what `components/shared/forms/use-form-submit.ts` does internally because that hook posts
 * and only posts — QR-01 renames with PATCH — and its unpacking is not exported. The duplication is
 * deliberate and small; folding both onto one helper belongs with a change to that module.
 */
export function readQrFailure(payload: unknown): QrFailure {
  const fallback: QrFailure = {
    code: 'INTERNAL_ERROR',
    message: 'Something went wrong. Please try again.',
    fields: [],
  };

  const error = readObject(readObject(payload)?.error);
  if (!error) return fallback;

  const details = readObject(error.details);
  const fields = Array.isArray(details?.fields)
    ? details.fields.filter((field): field is string => typeof field === 'string')
    : [];

  return {
    code: typeof error.code === 'string' ? error.code : fallback.code,
    message: typeof error.message === 'string' ? error.message : fallback.message,
    fields,
  };
}

/**
 * What a create or a rename hands back to the form that submitted it.
 *
 * The dialogs own their own busy and error states, and the screen owns the list — so a mutation
 * returns either the row to fold in or the failure to render under a field, and never both.
 */
export type QrMutationOutcome = { ok: true; source: QrSource } | { ok: false; failure: QrFailure };

/**
 * The created date in the business's own timezone (AMENDMENT-004, AC-026).
 *
 * Delegates the timezone handling to `dashboard/presentation.ts` so an unrecognised IANA name falls
 * back the same way it does everywhere else on the dashboard. Null for an unparseable instant,
 * which the table renders as a dash — a date is context here, not something to fail a row over.
 */
export function formatCreatedAt(iso: string, timezone: string): string | null {
  const createdAt = new Date(iso);
  return Number.isNaN(createdAt.getTime()) ? null : formatDate(createdAt, timezone);
}

/**
 * Client-side label check, so the commonest two mistakes are caught before a round trip.
 *
 * Returns the message to show, or null when the label is fine. The server re-checks both rules —
 * `parseQrSourceCreate` rejects a whitespace-only label for the same reason given here — so this
 * is about a faster answer, never about being the gate.
 */
export function labelError(value: string): string | null {
  const label = value.trim();
  if (label === '') return 'Give this QR a source label, such as Reception or Billing Counter.';
  if (label.length > LABEL_MAX) return `Use ${LABEL_MAX} characters or fewer.`;
  return null;
}

export function noteError(value: string): string | null {
  return value.trim().length > NOTE_MAX ? `Use ${NOTE_MAX} characters or fewer.` : null;
}

function readObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

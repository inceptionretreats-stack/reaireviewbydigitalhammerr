import type { Business } from '@ai-review/db';
import { formatReceivedAt, type FeedbackStatus } from './filters';

/**
 * The wire shape of `GET /api/v1/feedback`, and the view model the inbox renders.
 *
 * One definition for both, in an isomorphic module, because the first page of the inbox is
 * rendered on the server and every later page arrives in the browser from the same endpoint. If
 * the two paths built their own row objects, a field added to the API would appear in one and not
 * the other, and only after scrolling.
 *
 * ## AC-039, which governs this file
 *
 * `name` and `mobile` are the customer's own contact details, given optionally on a form that
 * asked nothing else about them (FB-01). They belong to the business, and FB-02 exists to show
 * them to it. What AC-039 forbids is them going anywhere else: no public page, no analytics
 * property, no aggregate export. This module and the inbox that consumes it are the only place in
 * the product that renders them, and there is deliberately no export from this screen — see the
 * note in `FeedbackInbox.tsx`.
 */

/** Snake case, matching the route handler's JSON — the wire names are not renamed on the way in. */
export interface FeedbackWireItem {
  id: string;
  message: string;
  /** PII. Null when the customer chose not to give it; both fields are optional on FB-01. */
  name: string | null;
  mobile: string | null;
  status: FeedbackStatus;
  /** UTC instant. The business timezone is applied when it is formatted, never in transport. */
  created_at: string;
  /** This row's keyset position, so "load more" needs no arithmetic on the client. */
  cursor: string;
}

export interface FeedbackRow {
  id: string;
  message: string;
  name: string | null;
  mobile: string | null;
  status: FeedbackStatus;
  /** Already formatted in the business timezone (AC-026); see the note on drift below. */
  receivedLabel: string;
  /** For a machine-readable `<time datetime>`, which must stay an unambiguous instant. */
  receivedIso: string;
  cursor: string;
}

/**
 * Wire item to view model.
 *
 * Called on the *server* for the first page: `FeedbackInboxSection` maps the page and hands
 * `initialRows` to the client component, so `receivedLabel` crosses the boundary as an already
 * serialized string and the browser renders the same characters the server sent.
 *
 * That is the whole reason the mapping is not done inside the client component. A `useState`
 * initializer runs a second time during hydration, so formatting there would evaluate
 * `Intl.DateTimeFormat` again against the browser's ICU data — and ICU 72 changed the separator
 * before am/pm from U+0020 to U+202F, so a Node build on an older ICU against a current Chrome
 * produces different text for the same instant, which React reports as a hydration mismatch and
 * repairs by throwing the server's markup away. Pages fetched by `loadMore` are formatted in the
 * browser, which is not a hydration path at all.
 */
export function toFeedbackRow(item: FeedbackWireItem, timeZone: string): FeedbackRow {
  const received = new Date(item.created_at);

  return {
    id: item.id,
    message: item.message,
    name: item.name,
    mobile: item.mobile,
    status: item.status,
    receivedLabel: formatReceivedAt(received, timeZone),
    receivedIso: received.toISOString(),
    cursor: item.cursor,
  };
}

/**
 * A one-line preview for the list, with the whole message kept for the detail view.
 *
 * Cut by code point rather than by UTF-16 code unit: `private_feedback.message` is free text from
 * an Indian consumer, so an emoji or any character outside the BMP is ordinary here, and slicing
 * a string would split a surrogate pair into a replacement character. The trailing ellipsis is a
 * real character rather than three dots, so a screen reader does not read "dot dot dot".
 */
export const PREVIEW_LENGTH = 140;

export function messagePreview(message: string, limit = PREVIEW_LENGTH): string {
  const collapsed = message.replace(/\s+/gu, ' ').trim();
  const points = Array.from(collapsed);
  if (points.length <= limit) return collapsed;
  return `${points.slice(0, limit).join('').trimEnd()}…`;
}

/**
 * Per-status totals behind the inbox's status chips.
 *
 * Keyed off the enum through `Lowercase<FeedbackStatus>`, so a fourth `feedback_status` member
 * makes `emptyFeedbackCounts` a compile error rather than a count the screen silently omits.
 */
export type FeedbackCounts = Record<Lowercase<FeedbackStatus>, number> & { total: number };

/** A factory, not a shared constant: the loader counts into it. */
export function emptyFeedbackCounts(): FeedbackCounts {
  return { new: 0, read: 0, archived: 0, total: 0 };
}

export const COUNT_KEY: Record<FeedbackStatus, Lowercase<FeedbackStatus>> = {
  NEW: 'new',
  READ: 'read',
  ARCHIVED: 'archived',
};

/**
 * Moves one message between two counts after a successful status change.
 *
 * The inbox adjusts its chips this way rather than refetching them. A reload after every Mark read
 * would throw away the pages the merchant has already scrolled through, and the arithmetic is
 * exact for the case that matters: the row is on screen, so it is inside the counted date range,
 * and the server has just confirmed the write. `total` does not move, because archiving is filing
 * rather than deleting — the message is still one of the messages this business has received.
 */
export function shiftCounts(
  counts: FeedbackCounts,
  from: FeedbackStatus,
  to: FeedbackStatus,
): FeedbackCounts {
  if (from === to) return counts;

  const next = { ...counts };
  const fromKey = COUNT_KEY[from];
  // Clamped because another tab may have filed the same message first, and a negative chip is a
  // worse answer than a stale one.
  next[fromKey] = Math.max(0, next[fromKey] - 1);
  next[COUNT_KEY[to]] += 1;
  return next;
}

/**
 * `business_status` (packages/db `enums.ts`), derived rather than restated so a fifth lifecycle
 * member is a compile error in `PUBLIC_FORM_KIND` below instead of a status whose empty state
 * quietly says the wrong thing.
 */
export type BusinessLifecycle = Business['status'];

/**
 * What the never-received-anything empty state may honestly offer.
 *
 * Flow J: `/{slug}` and `/{slug}/feedback` serve an ACTIVE business only — every other status gets
 * the controlled unavailable page (`app/(customer)/[slug]/feedback/page.tsx`). A reserved slug is not evidence
 * of that. ONB-01 claims the slug during the identity save (`api/v1/business/route.ts`), long
 * before publish, so a DRAFT business already has an address that does not serve: offering "see
 * what your customers see" there walks the owner into the unavailable page and suppresses the one
 * line that would have helped them.
 */
export type PublicFormState =
  /** ACTIVE, with an address reserved: the link opens the real form. */
  | { kind: 'live'; url: string }
  /** Setup is unfinished, so publishing is genuinely the next step and worth naming. */
  | { kind: 'draft' }
  /**
   * Not reachable for some other reason — suspended, closed, or ACTIVE with no address yet. Stated
   * without a cause, because this screen does not know the cause and guessing at one invents it.
   */
  | { kind: 'not-serving' };

/**
 * Spelled as a complete Record so a fifth `business_status` member fails to compile here rather
 * than falling into whichever branch happens to be last.
 */
const PUBLIC_FORM_KIND: Record<BusinessLifecycle, PublicFormState['kind']> = {
  ACTIVE: 'live',
  DRAFT: 'draft',
  SUSPENDED: 'not-serving',
  CLOSED: 'not-serving',
};

/**
 * `TenantGuard.resolveActive` declares `status` as a bare string, so a value outside the enum is
 * reachable in the types. Widening the same table rather than casting keeps the lookup total: an
 * unrecognised status lands on the branch that offers no link and asserts no cause.
 */
const KIND_BY_STATUS: Readonly<Record<string, PublicFormState['kind'] | undefined>> =
  PUBLIC_FORM_KIND;

export function publicFormState(lifecycle: string, url: string | null): PublicFormState {
  const kind = KIND_BY_STATUS[lifecycle] ?? 'not-serving';

  // A link needs both halves: ACTIVE *and* an address that resolves. An ACTIVE business with no
  // slug cannot be reached at all, and it is not a business waiting to publish either, so it takes
  // the branch that claims nothing.
  if (kind === 'live') return url === null ? { kind: 'not-serving' } : { kind: 'live', url };
  return kind === 'draft' ? { kind: 'draft' } : { kind: 'not-serving' };
}

/**
 * Which of FB-02's body states to render.
 *
 * Decided in a pure function because two of the four cases are only reachable after the merchant
 * has acted, and the unit suite is DOM-free by design (`vitest.config.mts` collects `*.test.ts`
 * and configures no environment), so there is no rendered assertion available. Deciding it here is
 * what makes every state reachable in a test.
 */
export interface InboxBody {
  kind: 'never-received' | 'no-matches' | 'list';
  /**
   * The list is being rendered with nothing left in it: every row on this page was filed and a
   * further page remains. `Table` needs a message for that cell, or it draws column headers over a
   * single blank one.
   */
  pageEmptied: boolean;
}

export interface InboxBodyInput {
  rowCount: number;
  nextCursor: string | null;
  /**
   * Whether a from/to filter is applied. It matters because `selectCounts` scopes `total` to the
   * date range, so a total of 0 inside a range says nothing about all time.
   */
  hasDateFilter: boolean;
  total: number;
}

export function inboxBody({
  rowCount,
  nextCursor,
  hasDateFilter,
  total,
}: InboxBodyInput): InboxBody {
  if (rowCount > 0) return { kind: 'list', pageEmptied: false };

  // Archiving all 25 rows of a full page empties the list while the cursor still points at page
  // two. That is not an empty inbox, so the list stays — carrying a message instead of rows — and
  // Load more remains the way onward.
  if (nextCursor !== null) return { kind: 'list', pageEmptied: true };

  // No date filter and nothing counted at all is the only combination that proves this business has
  // never received a message. Inside a date range the counts describe the range and nothing more.
  const neverReceivedAny = !hasDateFilter && total === 0;
  return { kind: neverReceivedAny ? 'never-received' : 'no-matches', pageEmptied: false };
}

export interface FeedbackPagePayload {
  items: readonly FeedbackWireItem[];
  nextCursor: string | null;
}

/**
 * Validates a `GET /api/v1/feedback` body before the inbox trusts it.
 *
 * Not defensive theatre against our own endpoint: this is the boundary where an unknown shape
 * becomes typed data, and the alternative is a cast that would let a deployment skew — an older
 * page against a newer route, which is exactly what happens during a rolling release — surface as
 * `undefined` rendered into the table. Returning null lets the caller say "we could not load
 * more" instead.
 */
export function readFeedbackPage(payload: unknown): FeedbackPagePayload | null {
  if (!isRecord(payload)) return null;

  const rawItems = payload.feedback;
  if (!Array.isArray(rawItems)) return null;

  const items: FeedbackWireItem[] = [];
  for (const entry of rawItems) {
    const item = readWireItem(entry);
    if (item === null) return null;
    items.push(item);
  }

  const rawCursor = payload.next_cursor;
  if (rawCursor !== null && typeof rawCursor !== 'string') return null;

  return { items, nextCursor: rawCursor };
}

function readWireItem(entry: unknown): FeedbackWireItem | null {
  if (!isRecord(entry)) return null;

  const { id, message, name, mobile, status, created_at: createdAt, cursor } = entry;

  if (typeof id !== 'string' || typeof message !== 'string') return null;
  if (typeof createdAt !== 'string' || Number.isNaN(Date.parse(createdAt))) return null;
  if (typeof cursor !== 'string') return null;
  if (!isFeedbackStatus(status)) return null;

  return {
    id,
    message,
    name: typeof name === 'string' ? name : null,
    mobile: typeof mobile === 'string' ? mobile : null,
    status,
    created_at: createdAt,
    cursor,
  };
}

/**
 * The `feedback_status` values, spelled as a complete Record so a fourth enum member becomes a
 * compile error here rather than a status the inbox quietly refuses to parse.
 *
 * Case-sensitive on purpose: the wire carries the database's own spelling, which is what the PATCH
 * endpoint accepts back, so accepting `new` here would invite a client to send it there.
 */
const FEEDBACK_STATUS_VALUES: Record<FeedbackStatus, true> = {
  NEW: true,
  READ: true,
  ARCHIVED: true,
};

export function isFeedbackStatus(value: unknown): value is FeedbackStatus {
  return typeof value === 'string' && Object.hasOwn(FEEDBACK_STATUS_VALUES, value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

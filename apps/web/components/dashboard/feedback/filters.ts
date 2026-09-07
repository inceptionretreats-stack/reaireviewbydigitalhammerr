import type { PrivateFeedback } from '@ai-review/db';

/**
 * Filters, timezone boundaries and pagination for the private feedback inbox (FB-02).
 *
 * Pure and isomorphic on purpose. `GET /api/v1/feedback` parses request query parameters with
 * it, the server page parses the same names out of its own URL, and the client list builds its
 * "load more" query with it. One module is what keeps the address a merchant can bookmark and the
 * query the API accepts from drifting into two dialects.
 *
 * It sits beside the components rather than in `apps/web/lib/` for the same reason
 * `components/dashboard/summary.ts` gives: how this build is split across concurrent
 * workstreams. It is plain shared logic and belongs in `lib/`.
 *
 * Nothing here touches a Node API, because a client component imports it.
 */

/**
 * Derived from the schema rather than restated, so adding a member to the `feedback_status` enum
 * is a compile error in the places below that must enumerate it (`FeedbackCounts` in `inbox.ts`
 * is the one that bites) instead of a state the inbox silently never shows.
 */
export type FeedbackStatus = PrivateFeedback['status'];

/**
 * The states FB-02 can put a message into: READ (Mark read, and restoring an archived message) and
 * ARCHIVED (Archive).
 *
 * NEW is excluded on purpose. It means the owner has never opened the message, which stops being
 * true the moment they do, so there is no honest control that would set it back and none of FB-02's
 * three actions asks for one. `PATCH /api/v1/feedback/{id}` enforces the same set.
 */
export type AssignableFeedbackStatus = Extract<FeedbackStatus, 'READ' | 'ARCHIVED'>;

/**
 * What the `status` query parameter accepts.
 *
 * `inbox` is not a database state — it is NEW plus READ, and it is the default. That choice is
 * what makes Archive mean anything: FB-02 offers Archive as an action, and if the default view
 * showed every row regardless of status then archiving would visibly do nothing. Archived rows
 * stay reachable through `archived` and `all`, because archiving is filing, not deleting — no
 * action on this screen destroys a customer's message.
 */
export const STATUS_FILTERS = ['inbox', 'new', 'read', 'archived', 'all'] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

export const DEFAULT_STATUS_FILTER: StatusFilter = 'inbox';

const STATUS_SETS: Record<StatusFilter, readonly FeedbackStatus[]> = {
  inbox: ['NEW', 'READ'],
  new: ['NEW'],
  read: ['READ'],
  archived: ['ARCHIVED'],
  all: ['NEW', 'READ', 'ARCHIVED'],
};

/** The database statuses a filter selects. Never empty, so the query is always well formed. */
export function statusesFor(filter: StatusFilter): readonly FeedbackStatus[] {
  return STATUS_SETS[filter];
}

export interface FeedbackFilters {
  status: StatusFilter;
  /** `YYYY-MM-DD`, inclusive, read in the business timezone (AC-026). Null means unbounded. */
  from: string | null;
  to: string | null;
}

export const DEFAULT_FEEDBACK_FILTERS: FeedbackFilters = {
  status: DEFAULT_STATUS_FILTER,
  from: null,
  to: null,
};

export interface ParsedFeedbackFilters {
  filters: FeedbackFilters;
  /**
   * Parameters that were present and not understood. The API turns a non-empty list into a 422;
   * the page ignores them, falls back to the default and says so on screen — a hand-edited or
   * stale URL should not be able to render a broken inbox.
   */
  rejected: readonly string[];
}

export type QueryInput = URLSearchParams | Readonly<Record<string, string | string[] | undefined>>;

/**
 * An absent parameter and a present-but-empty one mean the same thing here. That is not
 * tidiness: the filter form is a plain GET form, so clearing the date inputs submits
 * `?from=&to=`, and treating those as malformed would reject the act of clearing a filter.
 */
function readParam(input: QueryInput, key: string): string | null {
  const raw = input instanceof URLSearchParams ? input.get(key) : input[key];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

/**
 * Rejects a well-formed string that is not a real date. `2026-02-30` matches the pattern and
 * `Date.UTC` would roll it forward to 2 March, filtering on a day the merchant never asked for,
 * so the round trip is checked rather than assumed.
 */
function parseCalendarDate(value: string): CalendarDate | null {
  const match = DATE_ONLY.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const asUtc = new Date(Date.UTC(year, month - 1, day));

  if (
    asUtc.getUTCFullYear() !== year ||
    asUtc.getUTCMonth() !== month - 1 ||
    asUtc.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

export function parseFeedbackFilters(input: QueryInput): ParsedFeedbackFilters {
  const rejected: string[] = [];

  const rawStatus = readParam(input, 'status');
  let status = DEFAULT_STATUS_FILTER;
  if (rawStatus !== null) {
    const lowered = rawStatus.toLowerCase();
    const match = STATUS_FILTERS.find((candidate) => candidate === lowered);
    if (match === undefined) rejected.push('status');
    else status = match;
  }

  const from = readDate(input, 'from', rejected);
  const to = readDate(input, 'to', rejected);

  // An inverted range is dropped whole rather than half-applied. Keeping one end would filter on
  // something the merchant did not ask for, which on this screen looks like lost feedback.
  if (from !== null && to !== null && from > to) {
    return { filters: { status, from: null, to: null }, rejected: [...rejected, 'from', 'to'] };
  }

  return { filters: { status, from, to }, rejected };
}

function readDate(input: QueryInput, key: string, rejected: string[]): string | null {
  const raw = readParam(input, key);
  if (raw === null) return null;
  if (parseCalendarDate(raw) === null) {
    rejected.push(key);
    return null;
  }
  return raw;
}

export function hasDateFilter(filters: FeedbackFilters): boolean {
  return filters.from !== null || filters.to !== null;
}

export function isDefaultFilters(filters: FeedbackFilters): boolean {
  return filters.status === DEFAULT_STATUS_FILTER && !hasDateFilter(filters);
}

/**
 * AC-026: date filters run in the business's configured timezone, or the documented default of
 * Asia/Kolkata. `businesses.timezone` (AMENDMENT-004) is a free-text column, so an unrecognised
 * IANA name is reachable and must not take the screen down.
 *
 * Deliberately not reusing `components/dashboard/presentation.ts:formatDate`, which falls back to
 * UTC. Here one zone decides both the query boundary and the timestamp printed in the table, and
 * if those disagreed a row could be listed showing a date outside the range that selected it.
 * AC-026 names Asia/Kolkata as the documented default, so that is the fallback used for both.
 */
export const DEFAULT_TIME_ZONE = 'Asia/Kolkata';

export function resolveTimeZone(raw: string | null | undefined): string {
  if (raw === null || raw === undefined || raw.trim() === '') return DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: raw });
    return raw;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

const wallClockFormatters = new Map<string, Intl.DateTimeFormat>();

function wallClockFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = wallClockFormatters.get(timeZone);
  if (cached) return cached;

  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    // h23 rather than `hour12: false`: under the latter several engines render midnight as hour
    // 24, which would push every start-of-day boundary a day out.
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  wallClockFormatters.set(timeZone, formatter);
  return formatter;
}

interface WallClock extends CalendarDate {
  hour: number;
  minute: number;
  second: number;
}

/** What a clock in that zone reads at that instant. */
function wallClockAt(instant: Date, timeZone: string): WallClock {
  const parts = wallClockFormatter(timeZone).formatToParts(instant);
  const field = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((candidate) => candidate.type === type);
    return part === undefined ? 0 : Number(part.value);
  };

  return {
    year: field('year'),
    month: field('month'),
    day: field('day'),
    hour: field('hour'),
    minute: field('minute'),
    second: field('second'),
  };
}

/** The zone's offset from UTC at one instant, in milliseconds. */
function offsetMsAt(instant: Date, timeZone: string): number {
  const clock = wallClockAt(instant, timeZone);
  const asUtc = Date.UTC(
    clock.year,
    clock.month - 1,
    clock.day,
    clock.hour,
    clock.minute,
    clock.second,
  );

  // The formatted parts carry no milliseconds, so the instant's own are removed before
  // subtracting, or every offset would come out short by them.
  return asUtc - (instant.getTime() - instant.getUTCMilliseconds());
}

/**
 * Today's date in the business's zone, as `YYYY-MM-DD`.
 *
 * Used as the `max` on both date pickers. Computed in the tenant's zone rather than the browser's,
 * because a merchant in Kolkata whose laptop is set to UTC is still not able to receive feedback
 * tomorrow.
 */
export function todayInZone(timeZone: string, now: Date = new Date()): string {
  const clock = wallClockAt(now, timeZone);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${clock.year}-${pad(clock.month)}-${pad(clock.day)}`;
}

/**
 * The instant at which a given wall-clock midnight occurs in a zone.
 *
 * Two passes, not one. The first guess uses the offset in force at the *UTC* reading of that wall
 * clock, which lands on the wrong side of a DST transition roughly one day a year; the second
 * pass re-reads the offset at the corrected instant and converges. India has no DST, so this is
 * exact for the default zone either way, and it stays exact for a tenant who configures a zone
 * that does. On a spring-forward date, where local midnight genuinely does not exist, it settles
 * on the instant the day begins — the only useful answer for a range boundary.
 */
function zonedMidnight(date: CalendarDate, dayOffset: number, timeZone: string): Date {
  // Date.UTC normalises an overflowing day, so day + 1 crosses month and year ends correctly.
  const wallClock = Date.UTC(date.year, date.month - 1, date.day + dayOffset);
  const firstPass = wallClock - offsetMsAt(new Date(wallClock), timeZone);
  return new Date(wallClock - offsetMsAt(new Date(firstPass), timeZone));
}

export interface FeedbackDateRange {
  /** Inclusive lower bound, or null when unbounded. */
  startInclusive: Date | null;
  /** Exclusive upper bound: the start of the day after `to`, so `to` itself is included. */
  endExclusive: Date | null;
}

export function zonedDayRange(filters: FeedbackFilters, timeZone: string): FeedbackDateRange {
  const from = filters.from === null ? null : parseCalendarDate(filters.from);
  const to = filters.to === null ? null : parseCalendarDate(filters.to);

  return {
    startInclusive: from === null ? null : zonedMidnight(from, 0, timeZone),
    // Half-open, so a message stored at 23:59:59.999999 local on the `to` date is included
    // without anyone having to reason about the precision of the stored timestamp.
    endExclusive: to === null ? null : zonedMidnight(to, 1, timeZone),
  };
}

const displayFormatters = new Map<string, Intl.DateTimeFormat>();

/**
 * A received timestamp for display, in the business's own timezone.
 *
 * Time as well as date: several messages arriving on one day is the normal case, and a column of
 * identical dates gives the merchant no way to order or refer to them.
 *
 * `timeZone` is expected to have been through `resolveTimeZone`, so the constructor cannot throw.
 */
export function formatReceivedAt(value: Date, timeZone: string): string {
  const cached = displayFormatters.get(timeZone);
  if (cached) return cached.format(value);

  const formatter = new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  });
  displayFormatters.set(timeZone, formatter);
  return formatter.format(value);
}

/**
 * Keyset pagination position: the exact `created_at` of the last row returned, plus its id.
 *
 * Not an offset. Feedback is ordered newest first, so one message arriving between two page
 * requests shifts every offset by one and makes a merchant paging through their inbox see a row
 * twice or miss it entirely. A keyset is stable against inserts by construction.
 *
 * `at` is the timestamp as Postgres renders it, to microseconds — not an ISO string built from a
 * JavaScript Date. node-postgres parses `timestamptz` into a Date, which holds only
 * milliseconds, so a cursor round-tripped through one would skip any row whose timestamp fell
 * inside the truncated microseconds.
 *
 * Deliberately readable rather than an opaque blob. It carries only the timestamp and id of a row
 * the client already holds, so there is nothing in it to hide; what protects the query is that
 * both halves are matched against a strict pattern before either is ever bound.
 */
export interface FeedbackCursor {
  at: string;
  id: string;
}

const CURSOR_SEPARATOR = '~';
const CURSOR_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;
const CURSOR_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeFeedbackCursor(cursor: FeedbackCursor): string {
  return `${cursor.at}${CURSOR_SEPARATOR}${cursor.id}`;
}

export function parseFeedbackCursor(raw: string): FeedbackCursor | null {
  const separator = raw.indexOf(CURSOR_SEPARATOR);
  if (separator < 0) return null;

  const at = raw.slice(0, separator);
  const id = raw.slice(separator + 1);
  if (!CURSOR_TIMESTAMP.test(at) || !CURSOR_UUID.test(id)) return null;

  return { at, id };
}

/**
 * FB-02 specifies no page size, and a merchant reads an inbox by working down it rather than by
 * jumping to page nine. 25 fills a screen; the ceiling exists so that no single request can be
 * turned into an unbounded read of two thousand messages, each carrying a customer's name and
 * mobile (AC-039).
 */
export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 50;

export interface FeedbackPageRequest {
  limit: number;
  cursor: FeedbackCursor | null;
}

export interface ParsedFeedbackPageRequest extends FeedbackPageRequest {
  rejected: readonly string[];
}

export function parseFeedbackPageRequest(input: QueryInput): ParsedFeedbackPageRequest {
  const rejected: string[] = [];

  let limit = DEFAULT_PAGE_SIZE;
  const rawLimit = readParam(input, 'limit');
  if (rawLimit !== null) {
    const parsed = Number(rawLimit);
    // Rejected rather than clamped. A caller asking for 500 has misread the endpoint, and quietly
    // answering with 50 makes that impossible for them to notice.
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_PAGE_SIZE) rejected.push('limit');
    else limit = parsed;
  }

  let cursor: FeedbackCursor | null = null;
  const rawCursor = readParam(input, 'cursor');
  if (rawCursor !== null) {
    cursor = parseFeedbackCursor(rawCursor);
    if (cursor === null) rejected.push('cursor');
  }

  return { limit, cursor, rejected };
}

export const FEEDBACK_SCREEN_PATH = '/app/feedback';
export const FEEDBACK_API_PATH = '/api/v1/feedback';

/**
 * Query string for a set of filters, omitting anything already at its default so a shared link
 * stays readable and the unfiltered case is a bare path.
 */
export function feedbackQueryString(
  filters: FeedbackFilters,
  page: { cursor?: string; limit?: number } = {},
): string {
  const params = new URLSearchParams();
  if (filters.status !== DEFAULT_STATUS_FILTER) params.set('status', filters.status);
  if (filters.from !== null) params.set('from', filters.from);
  if (filters.to !== null) params.set('to', filters.to);
  if (page.cursor !== undefined) params.set('cursor', page.cursor);
  if (page.limit !== undefined && page.limit !== DEFAULT_PAGE_SIZE) {
    params.set('limit', String(page.limit));
  }
  return params.toString();
}

export function feedbackScreenHref(filters: FeedbackFilters): string {
  const query = feedbackQueryString(filters);
  return query === '' ? FEEDBACK_SCREEN_PATH : `${FEEDBACK_SCREEN_PATH}?${query}`;
}

export function feedbackApiHref(
  filters: FeedbackFilters,
  page: { cursor?: string; limit?: number } = {},
): string {
  const query = feedbackQueryString(filters, page);
  return query === '' ? FEEDBACK_API_PATH : `${FEEDBACK_API_PATH}?${query}`;
}

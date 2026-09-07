/**
 * Business-local date ranges for AN-01 (AC-026, AMENDMENT-004).
 *
 * AC-026: "Date filters use business-local configured timezone or documented default
 * Asia/Kolkata." Everything a range means on this screen is decided here, and every figure the
 * screen shows is bounded by the two absolute instants this module produces.
 *
 * Why the arithmetic is in TypeScript rather than `(occurred_at AT TIME ZONE tz)` in SQL: the
 * same reason `apps/worker/src/jobs/analytics/date-bucket.ts` gives. Resolving a local day to two
 * absolute instants keeps every scan a plain range predicate on `occurred_at`, which uses
 * `idx_events_business_time`; wrapping the column in a timezone conversion makes it unindexable,
 * and AMENDMENT-012 models that table at ~300M rows. It is also the only form of this logic that
 * is unit-testable without a database.
 *
 * DUPLICATION, stated rather than hidden. The day-boundary arithmetic below is the arithmetic the
 * worker's rollup uses, and it MUST stay identical: if the two disagree about which calendar day
 * an event at 19:00 UTC belongs to, the rollup files it under one date while this screen asks for
 * another, and the difference surfaces as a quiet few percent nobody can account for. It is
 * copied rather than imported because `apps/worker` is an application, not a package `apps/web`
 * may depend on. It belongs in `packages/analytics` beside the event taxonomy; that move is
 * outside this module's paths and is recorded as a follow-up.
 *
 * Everything here is pure. Intl supplies the timezone database.
 */

/** AC-026's documented default, matching the `businesses.timezone` column default. */
export const DEFAULT_TIME_ZONE = 'Asia/Kolkata';

/** Range used when the screen is opened with no filter applied. */
export const DEFAULT_RANGE_DAYS = 30;

/**
 * Longest range the endpoints will answer.
 *
 * Not a product limit — a bound on the work one request can ask for. A range is a scan of the
 * tenant's own slice of `analytics_events`, so leaving it unbounded lets a hand-written query
 * string decide how long a request takes.
 */
export const MAX_RANGE_DAYS = 366;

/**
 * 13-month retention on `analytics_events` (13_Security_Privacy_Compliance.md), in days.
 *
 * Nothing deletes rollup rows, so a range reaching past this window can have rollup numbers for
 * days whose raw events are gone. The resolved range says so and the screen prints a caveat,
 * rather than letting the daily trend and the range totals disagree in silence.
 */
export const EVENT_RETENTION_DAYS = 396;

export interface LocalDate {
  readonly year: number;
  /** 1-12, not the 0-11 that Date uses. */
  readonly month: number;
  readonly day: number;
}

export interface AnalyticsRange {
  /** Inclusive first local day, ISO YYYY-MM-DD. */
  readonly from: string;
  /** Inclusive last local day, ISO YYYY-MM-DD. */
  readonly to: string;
  /** The IANA zone every boundary above was resolved in. Named in the UI, per AC-026. */
  readonly timeZone: string;
  /** Inclusive lower bound, absolute. */
  readonly startUtc: Date;
  /** Exclusive upper bound, absolute. */
  readonly endUtc: Date;
  /** Every local day in the range, oldest first. Length is 1..MAX_RANGE_DAYS. */
  readonly days: readonly string[];
  /** The tenant's current local day, whether or not it falls inside the range. */
  readonly today: string;
  readonly includesToday: boolean;
  /** First instant of the tenant's current local day. Null when the range ends earlier. */
  readonly todayStartUtc: Date | null;
  /** True when `from` predates the 13-month event retention window. */
  readonly beyondEventRetention: boolean;
  /** True when a requested date in the future was pulled back to today. */
  readonly clampedFuture: boolean;
  /** True when `businesses.timezone` was unusable and the documented default was substituted. */
  readonly usedDefaultTimeZone: boolean;
}

export type RangeRejection = 'INVALID_DATE' | 'REVERSED' | 'TOO_LONG';

export type RangeResolution =
  | { ok: true; range: AnalyticsRange }
  | { ok: false; reason: RangeRejection; fields: readonly string[] };

export interface RangeRequest {
  /** Raw `from` query parameter, ISO YYYY-MM-DD. Absent derives it from `to`. */
  from?: string | null;
  /** Raw `to` query parameter, ISO YYYY-MM-DD. Absent means "up to today". */
  to?: string | null;
  /** Raw `businesses.timezone`; may be anything, so it is resolved rather than trusted. */
  timeZone?: string | null;
  /** Injected so resolution is deterministic in tests. */
  now: Date;
  /** Length of the default range when only one end is given. */
  days?: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone);
  if (cached) return cached;

  // hourCycle h23 rather than hour12:false: the latter can render midnight as hour "24" in some
  // locales, which silently shifts the computed offset by a day.
  const created = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  formatters.set(timeZone, created);
  return created;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

/**
 * AC-026's "or documented default".
 *
 * `businesses.timezone` is a free-form varchar, so a typo or a zone retired from the IANA
 * database must degrade to Asia/Kolkata rather than throw and take the analytics screen down.
 * The caller is told a substitution happened so the UI can name the zone it actually used — a
 * number whose day boundary the owner cannot identify is a number they cannot act on.
 */
export function resolveTimeZone(candidate: string | null | undefined): {
  timeZone: string;
  usedDefault: boolean;
} {
  if (candidate && isValidTimeZone(candidate)) return { timeZone: candidate, usedDefault: false };
  return { timeZone: DEFAULT_TIME_ZONE, usedDefault: true };
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function partsOf(instant: Date, timeZone: string): ZonedParts {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((candidate) => candidate.type === type);
    if (!part) throw new Error(`Intl returned no ${type} part for timezone ${timeZone}`);
    return Number(part.value);
  };

  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second'),
  };
}

/** Offset of `timeZone` from UTC at a given instant, in milliseconds (east of UTC positive). */
export function zoneOffsetMs(instant: Date, timeZone: string): number {
  const local = partsOf(instant, timeZone);
  const asIfUtc = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    local.second,
  );
  // Intl reports whole seconds, so compare against the instant truncated to whole seconds.
  return asIfUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

export function localDateOf(instant: Date, timeZone: string): LocalDate {
  const local = partsOf(instant, timeZone);
  return { year: local.year, month: local.month, day: local.day };
}

export function formatLocalDate(date: LocalDate): string {
  const month = String(date.month).padStart(2, '0');
  const day = String(date.day).padStart(2, '0');
  return `${String(date.year).padStart(4, '0')}-${month}-${day}`;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Parses an ISO calendar date, rejecting anything that is not a real day.
 *
 * The round-trip check is the part that earns its place: `Date.UTC(2026, 1, 30)` rolls over to
 * 2 March quite happily, so without it `from=2026-02-30` would be accepted and answered for a
 * different day than the caller asked about.
 */
export function parseLocalDate(value: string): LocalDate | null {
  const match = ISO_DATE.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const rolled = new Date(Date.UTC(year, month - 1, day));

  if (
    rolled.getUTCFullYear() !== year ||
    rolled.getUTCMonth() + 1 !== month ||
    rolled.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

export function addDays(date: LocalDate, delta: number): LocalDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day) + delta * 86_400_000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

export function compareLocalDates(a: LocalDate, b: LocalDate): number {
  if (a.year !== b.year) return a.year - b.year;
  if (a.month !== b.month) return a.month - b.month;
  return a.day - b.day;
}

/** Inclusive day count, so a range whose ends are equal is one day long. */
export function inclusiveDayCount(from: LocalDate, to: LocalDate): number {
  const a = Date.UTC(from.year, from.month - 1, from.day);
  const b = Date.UTC(to.year, to.month - 1, to.day);
  return Math.round((b - a) / 86_400_000) + 1;
}

/**
 * The first instant of a local calendar day.
 *
 * Two passes, because the offset that converts a wall-clock time into an instant depends on the
 * instant being converted. On a DST day the first guess sits on the wrong side of the transition
 * and the second corrects it.
 *
 * DST edge cases, stated rather than hidden:
 *
 *  - Spring forward across midnight (Chile, Cuba, Lord Howe — never India) means local 00:00 does
 *    not exist that day. The two candidates disagree and only the later one lands inside the
 *    target date, so that is the one chosen: the first instant the day actually has.
 *  - Fall back across midnight means local 00:00 happens twice; the earlier matching candidate
 *    wins, which is the first occurrence.
 *
 * The invariant that protects the numbers is weaker and absolute: a range's `endUtc` comes from
 * this same function applied to the day after `to`, so consecutive days abut exactly. No instant
 * can land in two days or in none, whatever a zone does.
 */
export function zonedStartOfDay(date: LocalDate, timeZone: string): Date {
  const naive = Date.UTC(date.year, date.month - 1, date.day, 0, 0, 0);
  const first = naive - zoneOffsetMs(new Date(naive), timeZone);
  const second = naive - zoneOffsetMs(new Date(first), timeZone);

  const candidates = first === second ? [first] : [first, second].sort((a, b) => a - b);
  for (const candidate of candidates) {
    if (compareLocalDates(localDateOf(new Date(candidate), timeZone), date) === 0) {
      return new Date(candidate);
    }
  }

  // Local midnight does not exist on this date, so the day begins at the transition itself.
  return new Date(Math.max(...candidates));
}

/**
 * Turns the two raw query parameters AN-01's filter sends into a range every read shares.
 *
 * The order of operations is deliberate. A future date is clamped to today rather than rejected,
 * because a native date picker produces one with a single keystroke and refusing it teaches the
 * owner nothing. A reversed or over-long range IS rejected, because the caller asked for
 * something specific and quietly answering a different question is worse than an error.
 */
export function resolveAnalyticsRange(request: RangeRequest): RangeResolution {
  const { timeZone, usedDefault } = resolveTimeZone(request.timeZone);
  const span = request.days ?? DEFAULT_RANGE_DAYS;
  const today = localDateOf(request.now, timeZone);

  const rawTo = request.to?.trim() ? request.to.trim() : null;
  const rawFrom = request.from?.trim() ? request.from.trim() : null;

  const parsedTo = rawTo === null ? today : parseLocalDate(rawTo);
  if (!parsedTo) return { ok: false, reason: 'INVALID_DATE', fields: ['to'] };

  const defaultFrom = addDays(parsedTo, -(span - 1));
  const parsedFrom = rawFrom === null ? defaultFrom : parseLocalDate(rawFrom);
  if (!parsedFrom) return { ok: false, reason: 'INVALID_DATE', fields: ['from'] };

  // Both ends are clamped, so `from=2030-01-01&to=2030-01-31` resolves to today rather than
  // reporting a reversed range the caller never wrote.
  const clampedFuture =
    compareLocalDates(parsedTo, today) > 0 || compareLocalDates(parsedFrom, today) > 0;
  const to = compareLocalDates(parsedTo, today) > 0 ? today : parsedTo;
  const from = compareLocalDates(parsedFrom, today) > 0 ? today : parsedFrom;

  if (compareLocalDates(from, to) > 0) {
    return { ok: false, reason: 'REVERSED', fields: ['from', 'to'] };
  }

  const dayCount = inclusiveDayCount(from, to);
  if (dayCount > MAX_RANGE_DAYS) {
    return { ok: false, reason: 'TOO_LONG', fields: ['from', 'to'] };
  }

  const days: string[] = [];
  for (let offset = 0; offset < dayCount; offset += 1) {
    days.push(formatLocalDate(addDays(from, offset)));
  }

  const includesToday = compareLocalDates(to, today) === 0;
  const retentionEdge = addDays(today, -(EVENT_RETENTION_DAYS - 1));

  return {
    ok: true,
    range: {
      from: formatLocalDate(from),
      to: formatLocalDate(to),
      timeZone,
      startUtc: zonedStartOfDay(from, timeZone),
      endUtc: zonedStartOfDay(addDays(to, 1), timeZone),
      days,
      today: formatLocalDate(today),
      includesToday,
      todayStartUtc: includesToday ? zonedStartOfDay(today, timeZone) : null,
      beyondEventRetention: compareLocalDates(from, retentionEdge) < 0,
      clampedFuture,
      usedDefaultTimeZone: usedDefault,
    },
  };
}

/** Message for a rejected range. Safe for a client: it repeats only what the caller sent. */
export function describeRangeRejection(reason: RangeRejection): string {
  switch (reason) {
    case 'INVALID_DATE':
      return 'Please give both dates as YYYY-MM-DD.';
    case 'REVERSED':
      return 'The start date must be on or before the end date.';
    default:
      return `Please choose a range of ${MAX_RANGE_DAYS} days or fewer.`;
  }
}

/**
 * The last completed local day, i.e. the newest day a nightly rollup could possibly cover.
 *
 * `completedDaysBefore` in the worker excludes the current local day for a reason worth
 * repeating here: a partial day written to `analytics_daily_business` is indistinguishable from a
 * complete one once stored. This is the reader's half of that agreement.
 */
export function lastCompletedDay(range: AnalyticsRange): string | null {
  const today = parseLocalDate(range.today);
  if (!today) return null;
  const yesterday = formatLocalDate(addDays(today, -1));

  // ISO dates compare correctly as strings, which is why every date on the range is stored in
  // that form rather than as a Date.
  if (yesterday < range.from) return null;
  return yesterday < range.to ? yesterday : range.to;
}

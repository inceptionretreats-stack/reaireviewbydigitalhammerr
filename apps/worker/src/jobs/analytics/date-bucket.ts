/**
 * Business-local day boundaries (AC-026, AMENDMENT-004).
 *
 * `analytics_daily_business.metric_date` is a bare `date`, so something has to decide which
 * calendar day an event at 2026-08-29T19:00Z belongs to. AC-026 is explicit that the answer is
 * the business-local timezone, defaulting to Asia/Kolkata — and for Asia/Kolkata (UTC+05:30)
 * that instant is already 00:30 on the 30th. A UTC day boundary would file it under the 29th,
 * and every dashboard would disagree with the owner's own sense of "yesterday" across the
 * busiest five and a half hours of the evening.
 *
 * Why the arithmetic lives here in TypeScript rather than as `(occurred_at AT TIME ZONE tz)`
 * in the aggregation query: resolving the window to two absolute instants keeps the scan a
 * plain range predicate on `occurred_at`, which uses idx_events_business_time. Wrapping the
 * column in a timezone conversion makes it unindexable, and at the 300M rows AMENDMENT-012
 * models that is the difference between a range scan and a sequential one. It is also the only
 * form of this logic that can be unit tested without a database.
 *
 * Everything here is pure; Intl supplies the timezone database.
 */

/** Documented fallback from AC-026, matching the businesses.timezone column default. */
export const DEFAULT_TIME_ZONE = 'Asia/Kolkata';

export interface LocalDate {
  readonly year: number;
  /** 1-12, not the 0-11 that Date uses. */
  readonly month: number;
  readonly day: number;
}

export interface DayWindow {
  /** ISO YYYY-MM-DD, the literal value written to analytics_daily_business.metric_date. */
  readonly metricDate: string;
  /** Inclusive lower bound, absolute. */
  readonly startUtc: Date;
  /** Exclusive upper bound, absolute. */
  readonly endUtc: Date;
  readonly timeZone: string;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone);
  if (cached) return cached;

  // hourCycle h23 rather than hour12:false: the latter can render midnight as hour "24" in
  // some locales, which silently shifts the computed offset by a day.
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
 * AC-026's "or documented default": `businesses.timezone` is free-form varchar, so a typo or a
 * zone retired from the IANA database must degrade to Asia/Kolkata rather than throw and take
 * the whole nightly rollup down with it. Callers log the substitution.
 */
export function resolveTimeZone(
  candidate: string | null | undefined,
  fallback: string = DEFAULT_TIME_ZONE,
): string {
  if (candidate && isValidTimeZone(candidate)) return candidate;
  return fallback;
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

/**
 * The first instant of a local calendar day.
 *
 * Two passes, because the offset that converts a wall-clock time into an instant depends on
 * the instant you are converting. On a DST day the first guess sits on the wrong side of the
 * transition and the second corrects it.
 *
 * DST edge cases, stated rather than hidden:
 *
 *  - Spring forward across midnight (Chile, Cuba, Lord Howe — never India) means local 00:00
 *    does not exist that day. The two candidates disagree and only the later one lands inside
 *    the target date, so that is the one chosen: the first instant the day actually has.
 *  - Fall back across midnight means local 00:00 happens twice; the earlier matching candidate
 *    wins, which is the first occurrence.
 *
 * The invariant that actually protects the data is weaker and absolute: dayWindow(D).endUtc is
 * produced by this same function for D+1, so consecutive windows abut exactly. No instant can
 * land in two days or in none, whatever a zone does. Worst case, on one day a year in a
 * handful of zones, an hour of events is attributed to the neighbouring day.
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

  // Local midnight does not exist on this date, so the day begins at the transition itself —
  // the later of the two candidates.
  return new Date(Math.max(...candidates));
}

export function dayWindow(date: LocalDate, timeZone: string): DayWindow {
  return {
    metricDate: formatLocalDate(date),
    startUtc: zonedStartOfDay(date, timeZone),
    endUtc: zonedStartOfDay(addDays(date, 1), timeZone),
    timeZone,
  };
}

/**
 * The `count` most recent local days that have fully elapsed, oldest first.
 *
 * "Fully elapsed" is why one UTC schedule serves every tenant: the day before a tenant's
 * current local date is over everywhere, by definition, whatever the offset. The current local
 * day is deliberately excluded — a partial day written to analytics_daily_business is
 * indistinguishable from a complete one once it is stored.
 */
export function completedDaysBefore(now: Date, timeZone: string, count: number): DayWindow[] {
  const today = localDateOf(now, timeZone);
  const windows: DayWindow[] = [];

  for (let offset = count; offset >= 1; offset -= 1) {
    windows.push(dayWindow(addDays(today, -offset), timeZone));
  }

  return windows;
}

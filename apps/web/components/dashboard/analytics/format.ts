import { parseLocalDate } from './range';

/**
 * Number and date formatting for AN-01.
 *
 * One module so the same figure is never spelled two ways on one screen, and so the one genuinely
 * subtle case has a single home: the dates on this screen are ALREADY business-local strings, and
 * running them through a timezone conversion a second time shifts them.
 */

const COUNT = new Intl.NumberFormat('en-IN');

export function formatCount(value: number): string {
  return COUNT.format(value);
}

/**
 * A percentage, or an em dash when there is no answer.
 *
 * Null means the denominator was zero, which has no percentage. Printing "0%" there would say
 * customers arrived and left, which is a different and untrue statement.
 */
export function formatPercent(value: number | null): string {
  if (value === null) return '—';
  // Whole numbers stay whole: "20%" rather than "20.0%". The value already carries at most one
  // decimal, so this only removes a trailing zero.
  return `${Number.isInteger(value) ? value : value.toFixed(1)}%`;
}

/**
 * A local day as "12 Aug".
 *
 * `timeZone: 'UTC'` against a date built with `Date.UTC` is not a mistake and not a fallback — it
 * is what stops a second conversion. The input is a calendar date the tenant's own zone already
 * decided (AC-026); formatting it in that zone again would move "1 Aug" in Asia/Kolkata to
 * "31 Jul" for anyone reading it, because 1 Aug 00:00 UTC is the previous evening in India.
 */
export function formatDayLabel(date: string): string {
  const parsed = parseLocalDate(date);
  if (!parsed) return date;

  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day)));
}

/** The same, with the year — for a range label, where "12 Aug" alone is ambiguous. */
export function formatDayLabelWithYear(date: string): string {
  const parsed = parseLocalDate(date);
  if (!parsed) return date;

  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day)));
}

/**
 * How the range reads in a sentence: "1 Aug 2026 to 30 Aug 2026 (Asia/Kolkata)".
 *
 * The zone is not decoration. AC-026 makes the day boundary a property of the tenant, so a count
 * for "30 August" is uninterpretable without knowing which midnight ended it.
 */
export function formatRangeLabel(from: string, to: string, timeZone: string): string {
  if (from === to) return `${formatDayLabelWithYear(from)} (${timeZone})`;
  return `${formatDayLabelWithYear(from)} to ${formatDayLabelWithYear(to)} (${timeZone})`;
}

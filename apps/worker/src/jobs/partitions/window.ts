/**
 * Partition naming and the retention window (AMENDMENT-012, 13_Security_Privacy_Compliance.md
 * "Anonymous raw event-level data: 13 months by default, then aggregate/delete").
 *
 * Pure on purpose. These functions decide which tables get DROPped, and a drop is silent and
 * irreversible: nobody reports missing history until a dashboard is asked for it months later.
 * Everything here is therefore testable without a database and tested at the boundary.
 */

export interface YearMonth {
  readonly year: number;
  /** 1-12. */
  readonly month: number;
}

/** Matches the names ensure_analytics_events_partition() creates: analytics_events_YYYY_MM. */
const PARTITION_PATTERN = /^analytics_events_(\d{4})_(\d{2})$/;

/**
 * The catch-all partition. Exists so an unexpected timestamp can never fail an insert and
 * break the customer flow (AC-035), and is never a drop candidate: it holds whatever the month
 * partitions did not, and its name carries no date to reason about.
 */
export const DEFAULT_PARTITION_NAME = 'analytics_events_default';

export function partitionNameFor(month: YearMonth): string {
  return `analytics_events_${String(month.year).padStart(4, '0')}_${String(month.month).padStart(2, '0')}`;
}

/** First day of the month as YYYY-MM-DD, the argument ensure_analytics_events_partition takes. */
export function firstDayOf(month: YearMonth): string {
  return `${String(month.year).padStart(4, '0')}-${String(month.month).padStart(2, '0')}-01`;
}

/**
 * Strict parse. Returns null for the DEFAULT partition, for a table that merely starts with
 * the prefix, and for an impossible month — anything unparseable is never droppable.
 */
export function parsePartitionName(name: string): YearMonth | null {
  const match = PARTITION_PATTERN.exec(name);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(year) || year < 2000 || year > 9999) return null;
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;

  return { year, month };
}

export function monthOfUtc(instant: Date): YearMonth {
  return { year: instant.getUTCFullYear(), month: instant.getUTCMonth() + 1 };
}

export function addMonths(month: YearMonth, delta: number): YearMonth {
  const total = month.year * 12 + (month.month - 1) + delta;
  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}

export function compareMonths(a: YearMonth, b: YearMonth): number {
  return a.year !== b.year ? a.year - b.year : a.month - b.month;
}

/**
 * Months that must exist: the current one and `monthsAhead` after it.
 *
 * Computed in UTC because `analytics_events` is range-partitioned on `occurred_at`, which is
 * timestamptz — the partition bounds are absolute instants and have nothing to do with any
 * tenant's local day. Pre-creating well ahead is the whole point: the DEFAULT partition only
 * stays empty if the month partition already exists when the first event of that month lands.
 */
export function monthsToEnsure(now: Date, monthsAhead: number): YearMonth[] {
  const current = monthOfUtc(now);
  const months: YearMonth[] = [];
  for (let offset = 0; offset <= monthsAhead; offset += 1) {
    months.push(addMonths(current, offset));
  }
  return months;
}

/**
 * The oldest month that must be kept. Anything strictly older may be dropped.
 *
 * The off-by-one-month trap this encodes: with 13-month retention on 2026-08-29, the naive
 * reading is "drop everything before 2025-08". But the analytics_events_2025_07 partition
 * covers up to 2025-07-31, which on 2026-08-29 is twelve months and twenty-nine days old —
 * still inside the 13 months the policy promises to keep. Dropping it deletes data the policy
 * says is retained, and nothing would ever catch it.
 *
 * The correct rule: a partition [start, end) is droppable only once its newest possible row is
 * already older than the retention period, i.e. `end <= now - retentionMonths`. In month space
 * that is exactly "month < month(now) - retentionMonths", which is what this returns. Working
 * in month space also sidesteps day-of-month clamping (subtracting a month from the 31st).
 */
export function firstRetainedMonth(now: Date, retentionMonths: number): YearMonth {
  return addMonths(monthOfUtc(now), -retentionMonths);
}

export interface DropPlan {
  /** Partition names cleared for DROP, oldest first, capped by maxDrops. */
  drop: string[];
  /** Droppable but deferred by the per-run cap; they come back on the next run. */
  deferred: string[];
  /** Names that are not month partitions at all, including the DEFAULT partition. */
  unrecognised: string[];
  /** The cutoff used, echoed so it can be logged next to whatever is about to be dropped. */
  firstRetainedMonth: YearMonth;
}

/**
 * Decides what may be dropped. Refuses everything it does not positively recognise.
 *
 * `maxDrops` is a blast radius cap, not an optimisation: a correct run has at most one
 * partition to drop per month, so a larger number only ever clears a backlog — and if the
 * cutoff maths is ever wrong, the cap is what stops one run taking the archive with it.
 */
export function planPartitionDrops(
  partitionNames: readonly string[],
  now: Date,
  retentionMonths: number,
  maxDrops: number,
): DropPlan {
  const cutoff = firstRetainedMonth(now, retentionMonths);
  const unrecognised: string[] = [];
  const candidates: { name: string; month: YearMonth }[] = [];

  for (const name of partitionNames) {
    const month = parsePartitionName(name);
    if (!month) {
      unrecognised.push(name);
      continue;
    }
    if (compareMonths(month, cutoff) < 0) {
      candidates.push({ name, month });
    }
  }

  candidates.sort((a, b) => compareMonths(a.month, b.month));

  return {
    drop: candidates.slice(0, maxDrops).map((candidate) => candidate.name),
    deferred: candidates.slice(maxDrops).map((candidate) => candidate.name),
    unrecognised,
    firstRetainedMonth: cutoff,
  };
}

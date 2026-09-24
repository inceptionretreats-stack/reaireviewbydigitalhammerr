import { FUNNEL_EVENTS, type EventName, type FunnelEvent } from '@ai-review/analytics';
import {
  addDays,
  compareLocalDates,
  EVENT_RETENTION_DAYS,
  formatLocalDate,
  lastCompletedDay,
  parseLocalDate,
  zonedStartOfDay,
  type AnalyticsRange,
} from './range';

/**
 * Every derived metric on AN-01: the funnel, its drop-off, and the daily trend.
 *
 * Pure by design — no database, no React — so the arithmetic that decides what an owner reads can
 * be tested exhaustively, and so the route handlers and the screen cannot each derive a metric
 * their own way. It is the reader's counterpart to `apps/worker/src/jobs/analytics/metrics.ts`.
 *
 * AN-01-01 — "metric definitions match event taxonomy" — is held structurally, not by review.
 * `STEP_COPY` is a `Record<FunnelEvent, …>` over `FUNNEL_EVENTS` from `@ai-review/analytics`, and
 * that array is generated from `11_Analytics_Event_Taxonomy.csv`. Adding a funnel step, removing
 * one, or renaming an event in the CSV therefore fails to compile here rather than leaving this
 * screen quietly describing a funnel the product no longer has.
 *
 * AC-025, DASH-01-02 and D-028 govern the last step and nothing else on this screen may go past
 * it. `google_open` records that the Google review page was OPENED. The label is the exact wording
 * `18_UI_UX_Design_System_Brief.md` mandates — "Google review page opened" — and there is no sixth
 * step, no "completed" figure and no conversion metric derived from it as though it were a
 * submission, because the platform cannot observe one. The event catalogue offers nothing that
 * would allow it either.
 *
 * D-009 has a consequence here too: no star rating is collected anywhere before Google, so there
 * is no rating to segment or average, and none appears.
 */

interface FunnelStepCopy {
  readonly label: string;
  /** One plain sentence saying what the platform actually observed. */
  readonly description: string;
}

const STEP_COPY: Record<FunnelEvent, FunnelStepCopy> = {
  qr_scan: {
    label: 'QR code scanned',
    description: 'A customer scanned one of your QR codes.',
  },
  review_page_view: {
    label: 'Review page opened',
    description: 'The review page finished loading, whether reached by QR code or by link.',
  },
  ai_generate_success: {
    label: 'Ai draft created',
    description: 'A usable draft came back for the customer to read and edit.',
  },
  review_copy: {
    label: 'Review copied',
    description: 'The customer copied the wording to their clipboard.',
  },
  google_open: {
    label: 'Google review page opened',
    description:
      'The customer opened your Google review page. This is the last thing we can see — what ' +
      'they write there, and whether they post it, is between them and Google.',
  },
};

export interface FunnelStepDefinition extends FunnelStepCopy {
  readonly event: FunnelEvent;
}

/** The funnel in order, derived from the taxonomy so the two cannot drift (AN-01-01). */
export const FUNNEL_STEPS: readonly FunnelStepDefinition[] = FUNNEL_EVENTS.map((event) => ({
  event,
  ...STEP_COPY[event],
}));

/**
 * Whether a step gained or lost sessions against the one before it.
 *
 * `gained` is a real state, not a rounding artefact, and clamping it away would hide something
 * true: `review_page_view` legitimately exceeds `qr_scan` whenever customers reach the review page
 * from the public profile page or a shared link instead of a standee. A funnel drawn as though
 * every step must be smaller than the last would attribute those visitors to a QR code that was
 * never scanned.
 */
export type StepChange = 'entry' | 'dropped' | 'gained' | 'unchanged';

export interface FunnelStep extends FunnelStepDefinition {
  /**
   * Distinct anonymous sessions that reached this step.
   *
   * AN-01-02: a session is not a person. One customer on two devices is two sessions, and a
   * customer who clears their cookies is another. Every caller that renders this must say so.
   */
  readonly sessions: number;
  /** Percentage of the first step's sessions, to one decimal. Null when the first step is 0. */
  readonly shareOfEntry: number | null;
  readonly change: StepChange;
  /** Sessions lost against the previous step. Negative means gained. Zero at the entry step. */
  readonly changeSessions: number;
  /** Magnitude of `changeSessions` as a percentage of the previous step, to one decimal. */
  readonly changePercent: number | null;
}

export interface FunnelSummary {
  readonly steps: readonly FunnelStep[];
  /** Sessions at the first step, which is what every share is measured against. */
  readonly entrySessions: number;
  /** Sessions that opened the Google review page. Never described as anything more (AC-025). */
  readonly reachedGoogleSessions: number;
  readonly reachedGooglePercent: number | null;
  /** True when no step recorded a single session — the honest `empty` state, not a flat chart. */
  readonly isEmpty: boolean;
  /**
   * Index of the step that lost the most sessions, or null when nothing was lost. The actual
   * product question this screen exists to answer: where are customers giving up.
   */
  readonly largestDropIndex: number | null;
}

/** Session counts keyed by funnel event. Absent keys count as zero. */
export type FunnelSessionCounts = Readonly<Partial<Record<FunnelEvent, number>>>;

/** One decimal place: enough to distinguish 12.4% from 12.9%, not enough to imply precision. */
function toPercent(part: number, whole: number): number | null {
  if (whole <= 0) return null;
  return Math.round((part / whole) * 1000) / 10;
}

export function buildFunnel(counts: FunnelSessionCounts): FunnelSummary {
  const steps: FunnelStep[] = [];
  let entrySessions = 0;

  FUNNEL_STEPS.forEach((definition, index) => {
    const sessions = counts[definition.event] ?? 0;
    if (index === 0) entrySessions = sessions;

    const previous = index === 0 ? null : (steps[index - 1]?.sessions ?? 0);
    const changeSessions = previous === null ? 0 : previous - sessions;

    let change: StepChange = 'entry';
    if (previous !== null) {
      if (changeSessions > 0) change = 'dropped';
      else if (changeSessions < 0) change = 'gained';
      else change = 'unchanged';
    }

    steps.push({
      ...definition,
      sessions,
      shareOfEntry: toPercent(sessions, entrySessions),
      change,
      changeSessions,
      changePercent: previous === null ? null : toPercent(Math.abs(changeSessions), previous),
    });
  });

  const terminal = steps[steps.length - 1];
  const reachedGoogleSessions = terminal?.sessions ?? 0;

  let largestDropIndex: number | null = null;
  let largestDrop = 0;
  steps.forEach((step, index) => {
    if (step.change === 'dropped' && step.changeSessions > largestDrop) {
      largestDrop = step.changeSessions;
      largestDropIndex = index;
    }
  });

  return {
    steps,
    entrySessions,
    reachedGoogleSessions,
    reachedGooglePercent: toPercent(reachedGoogleSessions, entrySessions),
    isEmpty: steps.every((step) => step.sessions === 0),
    largestDropIndex,
  };
}

/**
 * The events this screen reports totals for, beyond the funnel.
 *
 * Listed explicitly and typed as `EventName` so a metric can never be invented: a name that is
 * not in the taxonomy will not typecheck (AN-01-01). `ai_generate_failure` is here because an
 * owner whose customers keep hitting a failed generation needs to see that, and it is the one
 * number on the screen that is bad news when it rises.
 */
export const REPORTED_EVENTS = [
  ...FUNNEL_EVENTS,
  'profile_view',
  'profile_link_click',
  'ai_generate_failure',
  'private_feedback_submit',
] as const satisfies readonly EventName[];

export type ReportedEvent = (typeof REPORTED_EVENTS)[number];

/** Event totals keyed by event name. Absent keys count as zero. */
export type EventTotals = Readonly<Partial<Record<ReportedEvent, number>>>;

export function totalOf(totals: EventTotals, event: ReportedEvent): number {
  return totals[event] ?? 0;
}

/**
 * Narrows an event name that arrived as a plain string — a `varchar` event_name, or a rollup's
 * `dimension_key`.
 *
 * A `find` over eight literals rather than a cast: a cast would let a name the taxonomy no longer
 * contains through as a reported metric, which is the exact drift AN-01-01 exists to prevent. Null
 * means "outside what this screen reports", and callers drop it rather than aggregating it.
 */
export function asReportedEvent(name: string): ReportedEvent | null {
  return REPORTED_EVENTS.find((candidate) => candidate === name) ?? null;
}

/** The same narrowing for the funnel's own five events. */
export function asFunnelEvent(name: string): FunnelEvent | null {
  return FUNNEL_EVENTS.find((candidate) => candidate === name) ?? null;
}

/**
 * One day of the trend line.
 *
 * `pending` is the point of this type. A day the nightly rollup has not reached yet is NOT zero,
 * and drawing it as zero is precisely the failure this screen has to avoid: an owner reading a
 * flat line at the right-hand edge would conclude their standees had stopped working. A pending
 * day carries no counts and is drawn as a gap.
 */
export interface TrendDay {
  readonly date: string;
  readonly pending: boolean;
  /** Counted live rather than read from a rollup — true only for the tenant's current local day. */
  readonly live: boolean;
  readonly counts: EventTotals;
}

/** One `event_count` row from `analytics_daily_business`, as the rollup stores it. */
export interface RollupRow {
  readonly metricDate: string;
  /** The event name — that is what the worker puts in `dimension_key` for `event_count`. */
  readonly dimensionKey: string;
  readonly metricValue: number;
}

/**
 * Assembles the daily trend from the rollup, today's live count, and gaps for everything else.
 *
 * The three-way branch is the entire point of this function. A day is either summarised (rollup),
 * the tenant's current local day (counted live, because no rollup ever covers it), or not
 * summarised yet — and a day that is not summarised yet is NEVER zero.
 *
 * That last distinction is the one that silently misleads if nobody implements it. The worker omits
 * zero-valued rows to keep the table small, so "no rows for this date" means either "nothing
 * happened" or "the job has not got here". Only `rollupThrough` — `max(metric_date)` for the
 * tenant — separates the two, and without it a nightly job that fell over would draw a flat line
 * at zero across the most recent week, which an owner would read as their standees having died.
 *
 * `gapIsGenuinelyEmpty` is the other half of that honesty, and it corrects the mirror-image
 * failure. Because the worker omits zero rows, a tenant who recorded nothing on a completed day
 * produces no rows for it at all and `max(metric_date)` never advances — so a quiet spell, and
 * every brand-new tenant, made a perfectly healthy rollup look stalled and reported days the job
 * had already processed as "we do not know". When the caller has established with a live count
 * that not one event exists anywhere past the rollup's edge, those days are zero whether the job
 * has run or not, and claiming ignorance of a number we do know is its own kind of dishonesty.
 * Defaults to false: PENDING is the conservative answer, so a caller that cannot establish this
 * keeps the safe behaviour rather than inheriting a claim it has not checked.
 */
export function assembleTrend(
  range: AnalyticsRange,
  rollupRows: readonly RollupRow[],
  todayCounts: EventTotals,
  rollupThrough: string | null,
  gapIsGenuinelyEmpty = false,
): TrendDay[] {
  const byDate = new Map<string, Partial<Record<ReportedEvent, number>>>();
  for (const row of rollupRows) {
    const event = asReportedEvent(row.dimensionKey);
    if (!event) continue;
    const bucket = byDate.get(row.metricDate) ?? {};
    bucket[event] = (bucket[event] ?? 0) + row.metricValue;
    byDate.set(row.metricDate, bucket);
  }

  return range.days.map((date) => {
    if (date === range.today) {
      return { date, pending: false, live: true, counts: todayCounts };
    }
    if (rollupThrough !== null && date <= rollupThrough) {
      return { date, pending: false, live: false, counts: byDate.get(date) ?? {} };
    }
    // Past the rollup edge. A live count over the whole gap said there is nothing there, so the
    // day is a known zero rather than an unknown — see the note on `gapIsGenuinelyEmpty` above.
    if (gapIsGenuinelyEmpty) {
      return { date, pending: false, live: false, counts: {} };
    }
    return { date, pending: true, live: false, counts: {} };
  });
}

/**
 * The completed days a range covers that the rollup has not reached, as one absolute window.
 *
 * Those days are always contiguous — every day in the range after `rollupThrough` up to the last
 * completed one — so one range predicate on `occurred_at` answers "was anything at all recorded
 * in the part of this range the nightly job has not summarised?". A zero there means every one of
 * those days is a genuine zero, which is what `assembleTrend`'s `gapIsGenuinelyEmpty` needs.
 *
 * Null when there is no gap to ask about: no completed day in the range, or the rollup already
 * covers every completed day in it. The caller then skips the query entirely.
 */
export interface RollupGap {
  /** Inclusive first local day of the gap, ISO YYYY-MM-DD. */
  readonly from: string;
  /** Inclusive last local day of the gap. */
  readonly to: string;
  /** Inclusive lower bound, absolute. */
  readonly startUtc: Date;
  /** Exclusive upper bound, absolute. */
  readonly endUtc: Date;
  /**
   * False when the gap reaches past the 13-month `analytics_events` window
   * (13_Security_Privacy_Compliance.md). Rollup rows outlive the events they were built from, so
   * there a live count of zero would mean "the rows were purged", not "nothing happened", and
   * reporting those days as zero would invent data. The caller must not trust a zero then.
   */
  readonly withinEventRetention: boolean;
}

export function pendingRollupGap(
  range: AnalyticsRange,
  rollupThrough: string | null,
): RollupGap | null {
  const gapTo = lastCompletedDay(range);
  if (gapTo === null) return null;

  // ISO dates compare correctly as strings, which is why every date on the range is one.
  const afterEdge = rollupThrough === null ? null : dayAfter(rollupThrough);
  const gapFrom = afterEdge !== null && afterEdge > range.from ? afterEdge : range.from;
  if (gapFrom > gapTo) return null;

  const from = parseLocalDate(gapFrom);
  const to = parseLocalDate(gapTo);
  const today = parseLocalDate(range.today);
  if (!from || !to || !today) return null;

  const retentionEdge = addDays(today, -(EVENT_RETENTION_DAYS - 1));

  return {
    from: gapFrom,
    to: gapTo,
    startUtc: zonedStartOfDay(from, range.timeZone),
    // The day AFTER the last gap day, so the window is half-open and abuts the next day exactly.
    endUtc: zonedStartOfDay(addDays(to, 1), range.timeZone),
    withinEventRetention: compareLocalDates(from, retentionEdge) >= 0,
  };
}

function dayAfter(date: string): string | null {
  const parsed = parseLocalDate(date);
  return parsed === null ? null : formatLocalDate(addDays(parsed, 1));
}

export interface TrendSeries {
  readonly event: ReportedEvent;
  readonly label: string;
  readonly points: readonly { date: string; value: number | null }[];
  readonly max: number;
  readonly total: number;
}

/**
 * Extracts one plottable series from the daily trend.
 *
 * A pending day becomes `null`, not `0`, so the renderer has to decide what to do about a gap
 * rather than accidentally drawing through it.
 */
export function toSeries(
  days: readonly TrendDay[],
  event: ReportedEvent,
  label: string,
): TrendSeries {
  const points = days.map((day) => ({
    date: day.date,
    value: day.pending ? null : totalOf(day.counts, event),
  }));

  let max = 0;
  let total = 0;
  for (const point of points) {
    if (point.value === null) continue;
    if (point.value > max) max = point.value;
    total += point.value;
  }

  return { event, label, points, max, total };
}

import { and, asc, count, countDistinct, eq, gte, inArray, lt, lte, sql } from 'drizzle-orm';
import {
  analyticsDailyBusiness,
  analyticsEvents,
  businessLinks,
  businesses,
  qrCodes,
  type BusinessLink,
  type Database,
  type QrCode,
} from '@ai-review/db';
import { FUNNEL_EVENTS, type FunnelEvent } from '@ai-review/analytics';
import {
  asFunnelEvent,
  asReportedEvent,
  assembleTrend,
  buildFunnel,
  pendingRollupGap,
  REPORTED_EVENTS,
  type EventTotals,
  type FunnelSummary,
  type ReportedEvent,
  type RollupRow,
  type TrendDay,
} from './metrics';
import { lastCompletedDay, type AnalyticsRange } from './range';

/**
 * Every read behind AN-01 and the three `/api/v1/analytics/*` endpoints.
 *
 * ─── THE TWO SOURCES, AND WHY BOTH EXIST ─────────────────────────────────────────────────────
 *
 * `analytics_daily_business` is a nightly rollup written by `apps/worker`
 * (DailyAnalyticsAggregationJob). It is keyed (business_id, metric_date, metric_name,
 * dimension_key), and the worker writes exactly two metric names: `event_count` with the event
 * name in the dimension, and `unique_sessions` for funnel events plus a whole-day total. It
 * covers COMPLETED business-local days only — `completedDaysBefore` deliberately excludes the
 * current local day, because a partial day stored in that table is indistinguishable from a
 * finished one.
 *
 * That leaves three gaps, and every one of them silently under-reports if the reader does not
 * know it is there:
 *
 *  1. TODAY is never in the rollup. Read from the rollup alone, the current day always shows
 *     zero — which an owner reads as "my standees have stopped working", not as "not summarised
 *     yet". Today is therefore counted live from `analytics_events`, bounded by the tenant's own
 *     local midnight (AC-026).
 *
 *  2. DAYS THE JOB HAS NOT REACHED have no rows either, and a missing row is indistinguishable
 *     from a genuine zero because the worker deliberately omits zero-valued rows.
 *     `max(metric_date)` for the tenant says how far the rollup actually goes; a completed day
 *     past that is reported as PENDING and drawn as a gap in the trend, never as a zero.
 *
 *     The edge itself lies for the same reason it exists: omitting zero rows means a tenant with a
 *     quiet spell — and every brand-new tenant — never advances `max(metric_date)`, so days the
 *     job HAS processed looked unsummarised and a healthy rollup looked stalled. So one more live
 *     aggregate counts events in the gap between the edge and today: zero there means every one of
 *     those days is a known zero, and only a non-zero count leaves them genuinely unknown. It is
 *     bounded by the 13-month event window, past which a zero would mean "purged", not "quiet".
 *
 *  3. DISTINCT COUNTS ARE NOT ADDITIVE. The rollup stores distinct sessions per day, and summing
 *     thirty of those double-counts every visitor who came back. So the funnel and the
 *     unique-visitor figure cannot come from the rollup for any multi-day range; they are
 *     computed live over the whole window. That also keeps the KPI row and the funnel consistent
 *     with one another, which matters more than reusing the rollup — two figures on one screen
 *     that disagree destroy confidence in both.
 *
 * So: range totals, the funnel and unique visitors are LIVE over the window; the per-day trend
 * uses the ROLLUP for completed days — the one question that genuinely needs precomputation,
 * because it is day bucketing across a long range without a timezone conversion in the WHERE
 * clause — plus a live count for today. Reading range totals live rather than summing the rollup
 * is an interpretation of an underspecified requirement, and it is recorded as one.
 *
 * Neither the per-QR nor the per-link breakdown can come from the rollup at all: its
 * `dimension_key` holds the event name, so no QR or link dimension exists to read. Both are live
 * aggregates — worth knowing before someone assumes the rollup covers this screen.
 *
 * ─── TENANCY ─────────────────────────────────────────────────────────────────────────────────
 *
 * Every function takes an already-resolved `businessId` and never reads one itself. That is RBAC
 * rule 2 and AC-003: the id comes from `requireTenant`, which derives it from the session. Two
 * lookups here re-scope by tenant even though the event rows are already scoped, with the reason
 * given at each — `properties->>'link_id'` in particular arrives from a browser.
 *
 * Counts go through drizzle's `count`/`countDistinct`, which map to `Number` rather than leaving
 * the driver's bigint-as-text. One tenant's range cannot approach 2^31.
 */

/** Matches the cap in `/api/v1/qr`: a tenant has a handful of standees, not thousands. */
const MAX_QR_SOURCES = 500;

/** PROFILE-01 makes this a short ordered list; the cap only bounds a pathological row count. */
const MAX_LINKS = 200;

/** Widened once, so the `inArray` predicates below do not each restate the conversion. */
const FUNNEL_EVENT_NAMES: readonly string[] = FUNNEL_EVENTS;

/**
 * `analytics_daily_business.metric_date`, read as text rather than through the column.
 *
 * This is not a style choice — reading the column directly returns the WRONG DAY for this product's
 * own default timezone. `date('metric_date')` is drizzle's string-mode date column, whose
 * `mapFromDriverValue` does `value.toISOString().slice(0, -14)`. node-postgres parses a `date`
 * (OID 1082) with postgres-date, which yields a Date at LOCAL midnight, so under Asia/Kolkata —
 * AC-026 and AMENDMENT-004's documented default, and nothing in this repo pins TZ — the stored day
 * 2026-08-31 arrives as 2026-08-30T18:30:00Z and maps to the string '2026-08-30'.
 *
 * Every date on a range is an ISO string precisely so the comparisons in `range.ts` and
 * `metrics.ts` are plain string compares, so a day lost here is a day lost everywhere: the rollup
 * edge falls a day behind (one extra completed day shaded PENDING) and every rollup row lands in
 * the previous day's bucket, shifting the whole trend line and dropping the newest summarised day.
 *
 * Casting in SQL makes Postgres emit the ISO text itself. It arrives as `text` (OID 25), which
 * drizzle passes through untouched, so the value is correct whatever timezone the Node process
 * happens to run under. Exported so a test can assert the cast is still in the generated SQL.
 */
export const metricDateAsText = sql<string>`${analyticsDailyBusiness.metricDate}::text`;

/** The rollup edge, cast for the same reason. `max()` of no rows is null, and so is its cast. */
export const rollupEdgeAsText = sql<string | null>`max(${analyticsDailyBusiness.metricDate})::text`;

/**
 * Map key for activity with no `qr_code_id`. A uuid is never the empty string, so it cannot
 * collide with a real source.
 */
const DIRECT_KEY = '';

/** Copy for that bucket. Not a QR source, so it carries no id and no status. */
const DIRECT_LABEL = 'Opened without a QR code';

/**
 * The tenant's configured timezone, raw.
 *
 * Returned unvalidated on purpose: `resolveTimeZone` is the single place that decides whether a
 * stored value is usable and reports the substitution, so validating here as well would give two
 * answers to one question. Null means the business row is gone, which callers treat as
 * "not found" rather than defaulting silently.
 */
export async function loadBusinessTimeZone(
  db: Database,
  businessId: string,
): Promise<string | null> {
  const rows = await db
    .select({ timezone: businesses.timezone })
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);

  return rows[0]?.timezone ?? null;
}

/** The absolute window a range covers, so every query shares one predicate. */
function windowFor(businessId: string, range: AnalyticsRange) {
  return and(
    eq(analyticsEvents.businessId, businessId),
    gte(analyticsEvents.occurredAt, range.startUtc),
    lt(analyticsEvents.occurredAt, range.endUtc),
  );
}

export interface AnalyticsOverview {
  readonly range: AnalyticsRange;
  /** Event counts over the whole range, live. Every key is a taxonomy event name (AN-01-01). */
  readonly totals: EventTotals;
  /**
   * Distinct anonymous sessions with any activity in the range.
   *
   * AN-01-02: a session count, not a person count — callers must label it so. Read live because
   * a sum of daily distincts would double-count a visitor who came back.
   *
   * `count(distinct anonymous_session_id)` ignores NULLs, so an event recorded without a session
   * (the public flow skips the id rather than inventing one) contributes nothing here.
   */
  readonly uniqueVisitorSessions: number;
  readonly funnel: FunnelSummary;
  readonly trend: readonly TrendDay[];
  /** Newest local day the rollup covers for this tenant, or null when it has never run. */
  readonly rollupThrough: string | null;
  /** Completed days inside the range that the rollup does not cover yet. */
  readonly pendingDays: readonly string[];
}

export async function loadAnalyticsOverview(
  db: Database,
  businessId: string,
  range: AnalyticsRange,
): Promise<AnalyticsOverview> {
  const scope = windowFor(businessId, range);

  const [eventCountRows, funnelSessionRows, visitorRows, rollupEdgeRows] = await Promise.all([
    // Restricted to the reported events so an event added to the taxonomy later cannot silently
    // widen this scan.
    db
      .select({ eventName: analyticsEvents.eventName, events: count() })
      .from(analyticsEvents)
      .where(and(scope, inArray(analyticsEvents.eventName, [...REPORTED_EVENTS])))
      .groupBy(analyticsEvents.eventName),

    db
      .select({
        eventName: analyticsEvents.eventName,
        sessions: countDistinct(analyticsEvents.anonymousSessionId),
      })
      .from(analyticsEvents)
      .where(and(scope, inArray(analyticsEvents.eventName, [...FUNNEL_EVENT_NAMES])))
      .groupBy(analyticsEvents.eventName),

    // A second pass over the same index range rather than a grouping set, for the reason the
    // worker's own store gives: distinct sessions across all events is not derivable from the
    // per-event distincts, and the range is one tenant's slice.
    db
      .select({ sessions: countDistinct(analyticsEvents.anonymousSessionId) })
      .from(analyticsEvents)
      .where(scope),

    db
      .select({ latest: rollupEdgeAsText })
      .from(analyticsDailyBusiness)
      .where(eq(analyticsDailyBusiness.businessId, businessId)),
  ]);

  const rollupThrough = rollupEdgeRows[0]?.latest ?? null;
  const rollupCeiling = rollupCeilingFor(range, rollupThrough);

  // The gap is the completed part of the range the nightly job has not summarised. One aggregate
  // over it settles what `max(metric_date)` cannot: the worker omits zero-valued rows, so a
  // quiet spell — and every brand-new tenant — leaves the rollup edge parked while the job runs
  // perfectly. If not one event exists in the gap, those days are a known zero, not an unknown.
  // Skipped when the gap predates the 13-month event window, where a zero would mean the raw rows
  // were purged rather than that nothing happened, and reporting it as zero would invent data.
  const gap = pendingRollupGap(range, rollupThrough);
  const gapWindow = gap !== null && gap.withinEventRetention ? gap : null;

  const rollupQuery: Promise<RollupRow[]> =
    rollupCeiling === null
      ? Promise.resolve([])
      : db
          .select({
            metricDate: metricDateAsText,
            dimensionKey: analyticsDailyBusiness.dimensionKey,
            metricValue: analyticsDailyBusiness.metricValue,
          })
          .from(analyticsDailyBusiness)
          .where(
            and(
              eq(analyticsDailyBusiness.businessId, businessId),
              eq(analyticsDailyBusiness.metricName, 'event_count'),
              gte(analyticsDailyBusiness.metricDate, range.from),
              lte(analyticsDailyBusiness.metricDate, rollupCeiling),
              inArray(analyticsDailyBusiness.dimensionKey, [...REPORTED_EVENTS]),
            ),
          );

  const todayQuery: Promise<{ eventName: string; events: number }[]> =
    range.todayStartUtc === null
      ? Promise.resolve([])
      : db
          .select({ eventName: analyticsEvents.eventName, events: count() })
          .from(analyticsEvents)
          .where(
            and(
              eq(analyticsEvents.businessId, businessId),
              gte(analyticsEvents.occurredAt, range.todayStartUtc),
              lt(analyticsEvents.occurredAt, range.endUtc),
              inArray(analyticsEvents.eventName, [...REPORTED_EVENTS]),
            ),
          )
          .groupBy(analyticsEvents.eventName);

  // Every event in the gap, not just the reported ones: the question is whether the tenant had any
  // activity at all, and a narrower predicate would let an unreported event be read as silence and
  // turn a real gap into a row of zeroes.
  const gapQuery: Promise<{ events: number }[]> =
    gapWindow === null
      ? Promise.resolve([])
      : db
          .select({ events: count() })
          .from(analyticsEvents)
          .where(
            and(
              eq(analyticsEvents.businessId, businessId),
              gte(analyticsEvents.occurredAt, gapWindow.startUtc),
              lt(analyticsEvents.occurredAt, gapWindow.endUtc),
            ),
          );

  // All three depend on `rollupThrough`, so they cannot join the batch above — but they do not
  // depend on each other, so they still cost one round trip between them rather than three.
  const [rollupRows, todayRows, gapRows] = await Promise.all([rollupQuery, todayQuery, gapQuery]);

  const todayCounts = totalsFrom(todayRows);

  const funnelCounts: Partial<Record<FunnelEvent, number>> = {};
  for (const row of funnelSessionRows) {
    const event = asFunnelEvent(row.eventName);
    if (event) funnelCounts[event] = row.sessions;
  }

  const gapIsGenuinelyEmpty = gapWindow !== null && (gapRows[0]?.events ?? -1) === 0;
  const trend = assembleTrend(range, rollupRows, todayCounts, rollupThrough, gapIsGenuinelyEmpty);

  return {
    range,
    totals: totalsFrom(eventCountRows),
    uniqueVisitorSessions: visitorRows[0]?.sessions ?? 0,
    funnel: buildFunnel(funnelCounts),
    trend,
    rollupThrough,
    pendingDays: trend.filter((day) => day.pending).map((day) => day.date),
  };
}

/**
 * The newest date a rollup read can usefully ask for: no later than the last completed day in
 * the range, and no later than the rollup itself has reached. Null when there is nothing to ask
 * for at all, which skips the query rather than issuing one that cannot match a row.
 */
function rollupCeilingFor(range: AnalyticsRange, rollupThrough: string | null): string | null {
  const rangeCeiling = lastCompletedDay(range);
  if (rangeCeiling === null || rollupThrough === null) return null;
  const ceiling = rollupThrough < rangeCeiling ? rollupThrough : rangeCeiling;
  return ceiling < range.from ? null : ceiling;
}

function totalsFrom(rows: readonly { eventName: string; events: number }[]): EventTotals {
  const totals: Partial<Record<ReportedEvent, number>> = {};
  for (const row of rows) {
    const event = asReportedEvent(row.eventName);
    if (event) totals[event] = row.events;
  }
  return totals;
}

/* ─── Per-QR-source performance: GET /api/v1/analytics/qr ──────────────────────────────────── */

export interface QrSourceMetrics {
  /** `qr_codes.id`, or null for activity that arrived without a QR code. */
  readonly qrCodeId: string | null;
  readonly label: string;
  readonly status: QrCode['status'] | null;
  readonly scans: number;
  readonly reviewPagesOpened: number;
  readonly draftsCreated: number;
  readonly reviewsCopied: number;
  /** AC-025: the Google review page was opened. Nothing beyond that is observable. */
  readonly googlePagesOpened: number;
  readonly visitorSessions: number;
}

export interface QrSourceAnalytics {
  readonly range: AnalyticsRange;
  readonly sources: readonly QrSourceMetrics[];
  /** True when nothing at all was recorded in the range — the honest `empty` state. */
  readonly isEmpty: boolean;
}

export async function loadQrSourceAnalytics(
  db: Database,
  businessId: string,
  range: AnalyticsRange,
): Promise<QrSourceAnalytics> {
  const scope = windowFor(businessId, range);

  const [eventRows, sessionRows, sources] = await Promise.all([
    db
      .select({
        qrCodeId: analyticsEvents.qrCodeId,
        eventName: analyticsEvents.eventName,
        events: count(),
      })
      .from(analyticsEvents)
      .where(and(scope, inArray(analyticsEvents.eventName, [...FUNNEL_EVENT_NAMES])))
      .groupBy(analyticsEvents.qrCodeId, analyticsEvents.eventName),

    // Distinct sessions per source, not per (source, event): a visitor who scanned and then
    // copied is one session, and summing the per-event distincts would count them twice.
    db
      .select({
        qrCodeId: analyticsEvents.qrCodeId,
        sessions: countDistinct(analyticsEvents.anonymousSessionId),
      })
      .from(analyticsEvents)
      .where(scope)
      .groupBy(analyticsEvents.qrCodeId),

    // Labels come from rows scoped to the resolved tenant, never from the event row. Even if an
    // event ever carried a qr_code_id from elsewhere, it could not surface another tenant's
    // label — it would fall into the unrecognised bucket instead, which is the AC-003 rule that
    // a missing row and someone else's row must be indistinguishable.
    db
      .select({ id: qrCodes.id, sourceLabel: qrCodes.sourceLabel, status: qrCodes.status })
      .from(qrCodes)
      .where(eq(qrCodes.businessId, businessId))
      .orderBy(asc(qrCodes.createdAt), asc(qrCodes.id))
      .limit(MAX_QR_SOURCES),
  ]);

  const counts = new Map<string, Partial<Record<FunnelEvent, number>>>();
  for (const row of eventRows) {
    const event = asFunnelEvent(row.eventName);
    if (!event) continue;
    const key = row.qrCodeId ?? DIRECT_KEY;
    const bucket = counts.get(key) ?? {};
    bucket[event] = (bucket[event] ?? 0) + row.events;
    counts.set(key, bucket);
  }

  const sessions = new Map<string, number>();
  for (const row of sessionRows) {
    sessions.set(row.qrCodeId ?? DIRECT_KEY, row.sessions);
  }

  // Sources are listed whether or not they recorded anything: a standee that got nothing this
  // month is a finding, and QR-01 offers no delete path, so the list is stable.
  const rows: QrSourceMetrics[] = sources.map((source) =>
    metricsFor(source.id, source.sourceLabel, source.status, counts, sessions),
  );

  // Activity with no QR code, plus any id that matches no source this tenant owns — a disabled
  // source is still listed above, so in practice that means a row an admin deleted. Both are
  // added only when they carry activity, because a zero row here explains nothing.
  const owned = new Set(sources.map((source) => source.id));
  const orphanKeys = [...new Set([...counts.keys(), ...sessions.keys()])].filter(
    (key) => key === DIRECT_KEY || !owned.has(key),
  );

  for (const key of orphanKeys) {
    const isDirect = key === DIRECT_KEY;
    const metrics = metricsFor(
      isDirect ? null : key,
      isDirect ? DIRECT_LABEL : 'Unrecognised QR source',
      null,
      counts,
      sessions,
    );
    if (hasQrActivity(metrics)) rows.push(metrics);
  }

  return { range, sources: rows, isEmpty: rows.every((row) => !hasQrActivity(row)) };
}

function hasQrActivity(row: QrSourceMetrics): boolean {
  return (
    row.scans > 0 ||
    row.reviewPagesOpened > 0 ||
    row.draftsCreated > 0 ||
    row.reviewsCopied > 0 ||
    row.googlePagesOpened > 0 ||
    row.visitorSessions > 0
  );
}

function metricsFor(
  qrCodeId: string | null,
  label: string,
  status: QrCode['status'] | null,
  counts: ReadonlyMap<string, Partial<Record<FunnelEvent, number>>>,
  sessions: ReadonlyMap<string, number>,
): QrSourceMetrics {
  const key = qrCodeId ?? DIRECT_KEY;
  const bucket = counts.get(key) ?? {};

  return {
    qrCodeId,
    label,
    status,
    scans: bucket.qr_scan ?? 0,
    reviewPagesOpened: bucket.review_page_view ?? 0,
    draftsCreated: bucket.ai_generate_success ?? 0,
    reviewsCopied: bucket.review_copy ?? 0,
    googlePagesOpened: bucket.google_open ?? 0,
    visitorSessions: sessions.get(key) ?? 0,
  };
}

/* ─── Public profile link clicks: GET /api/v1/analytics/links ─────────────────────────────── */

export interface LinkClickMetrics {
  /** `business_links.id`, or null for the aggregate of clicks that cannot be attributed. */
  readonly linkId: string | null;
  readonly label: string;
  readonly linkType: BusinessLink['linkType'] | null;
  readonly isEnabled: boolean | null;
  readonly clicks: number;
  /**
   * Distinct sessions that clicked this link. Null on the unattributable row: those clicks come
   * from several unknown ids, and adding their distinct-session counts would count one visitor
   * once per link they touched. A figure that cannot be computed is reported as absent.
   */
  readonly visitorSessions: number | null;
}

export interface LinkClickAnalytics {
  readonly range: AnalyticsRange;
  /** Denominator for a click rate: how often the public profile page was viewed at all. */
  readonly profileViews: number;
  readonly links: readonly LinkClickMetrics[];
  readonly isEmpty: boolean;
}

export async function loadLinkClickAnalytics(
  db: Database,
  businessId: string,
  range: AnalyticsRange,
): Promise<LinkClickAnalytics> {
  const scope = windowFor(businessId, range);

  // `link_id` is the one dimension on this screen that arrives from a browser: PublicProfile
  // sends it in the event properties. It is therefore used ONLY as a lookup key against links
  // this tenant owns, and never rendered. Two consequences, both deliberate:
  //   * an id belonging to another tenant cannot surface that tenant's label — it lands in the
  //     unattributed row, which is AC-003's requirement that a missing row and someone else's
  //     row be reported identically;
  //   * `link_type` from the same properties is not selected at all, because it is unvalidated
  //     client text and this screen must not present it as the platform's own data.
  const linkIdExpression = sql<string | null>`${analyticsEvents.properties} ->> 'link_id'`;

  const [clickRows, profileViewRows, links] = await Promise.all([
    db
      .select({
        linkId: linkIdExpression,
        clicks: count(),
        sessions: countDistinct(analyticsEvents.anonymousSessionId),
      })
      .from(analyticsEvents)
      .where(and(scope, eq(analyticsEvents.eventName, 'profile_link_click')))
      .groupBy(linkIdExpression),

    db
      .select({ views: count() })
      .from(analyticsEvents)
      .where(and(scope, eq(analyticsEvents.eventName, 'profile_view'))),

    db
      .select({
        id: businessLinks.id,
        label: businessLinks.label,
        linkType: businessLinks.linkType,
        isEnabled: businessLinks.isEnabled,
      })
      .from(businessLinks)
      .where(eq(businessLinks.businessId, businessId))
      .orderBy(asc(businessLinks.sortOrder), asc(businessLinks.id))
      .limit(MAX_LINKS),
  ]);

  const owned = new Set(links.map((link) => link.id));
  const tallies = new Map<string, { clicks: number; sessions: number }>();
  let unattributedClicks = 0;

  for (const row of clickRows) {
    if (row.linkId !== null && owned.has(row.linkId)) {
      tallies.set(row.linkId, { clicks: row.clicks, sessions: row.sessions });
    } else {
      unattributedClicks += row.clicks;
    }
  }

  const rows: LinkClickMetrics[] = [];
  for (const link of links) {
    const tally = tallies.get(link.id);
    // A disabled link with no clicks is noise — it cannot be clicked, so a zero says nothing.
    // A disabled link WITH clicks matters: D-015 lets the owner hide a section at any time, so it
    // was enabled earlier in the range, and dropping it would leave the total unexplainable.
    if (!link.isEnabled && !tally) continue;

    rows.push({
      linkId: link.id,
      label: link.label,
      linkType: link.linkType,
      isEnabled: link.isEnabled,
      clicks: tally?.clicks ?? 0,
      visitorSessions: tally?.sessions ?? 0,
    });
  }

  if (unattributedClicks > 0) {
    rows.push({
      linkId: null,
      // Says nothing about which link it was. Naming it would mean trusting an id from a browser,
      // and the honest answer is that these clicks cannot be attributed.
      label: 'Removed or unrecognised link',
      linkType: null,
      isEnabled: null,
      clicks: unattributedClicks,
      visitorSessions: null,
    });
  }

  return {
    range,
    profileViews: profileViewRows[0]?.views ?? 0,
    links: rows,
    isEmpty: rows.every((row) => row.clicks === 0),
  };
}

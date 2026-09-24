import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/lib/infra/db';
import { requireTenant } from '@/lib/tenant/require-tenant';
import { loadAnalyticsOverview } from '@/lib/analytics/queries';
import type { FunnelStep, TrendDay } from '@/lib/analytics/metrics';
import { analyticsRangeFor, serializeRange } from '../range-request';

/**
 * GET /api/v1/analytics/overview — the KPI row, funnel and daily trend for AN-01 and DASH-01.
 *
 * The tenant is never taken from the request: `requireTenant` resolves it from the session, so
 * there is no business id in the URL or body for a caller to tamper with (RBAC rule 2, AC-003).
 * `?from=` and `?to=` are the only inputs, and they are dates, not identifiers.
 *
 * Deliberately not gated on `requireActiveTenant`. Flow J restricts a suspended tenant from
 * *mutating* configuration; this is a read, and an owner whose business has just been suspended
 * needs to see the history they are being asked about.
 *
 * ─── WHAT THIS ENDPOINT WILL NOT REPORT ──────────────────────────────────────────────────────
 *
 * AC-025 and DASH-01-02. The funnel's terminal step is `google_open`, and it means the Google
 * review page was OPENED. There is no field here counting reviews left, and none can be derived
 * from this response: `reached_google_percent` is a share of visitors who got that far, named
 * after the thing that was observed. The wording in `label` is the exact phrase
 * `18_UI_UX_Design_System_Brief.md` mandates, and a lint rule fails the build on the alternative.
 *
 * D-009: no star rating is collected before Google, so there is nothing to rate, average or
 * segment by, and no such field exists.
 *
 * AN-01-02: `unique_visitor_sessions` counts anonymous sessions. Two devices are two sessions and
 * a cleared cookie is another, so it is an upper bound on people and is named to say so. The
 * response repeats that in `unique_visitor_basis` because a JSON field name alone gets copied into
 * a spreadsheet and loses its caveat.
 *
 * The rollup/live split, and why `trend.pending_days` exists at all, is documented at the top of
 * `lib/analytics/queries.ts`. In short: no rollup ever covers the current local
 * day, so it is counted live, and a completed day the nightly job has not reached is reported as
 * pending rather than as zero.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireTenant(request);
  if (!auth.ok) return auth.response;

  const database = db();
  const { businessId } = auth.context;

  const range = await analyticsRangeFor(database, businessId, request);
  if (!range.ok) return range.response;

  const overview = await loadAnalyticsOverview(database, businessId, range.range);

  return NextResponse.json({
    range: serializeRange(overview.range),
    totals: overview.totals,
    unique_visitor_sessions: overview.uniqueVisitorSessions,
    // AN-01-02, restated in the payload so it survives being exported.
    unique_visitor_basis: 'anonymous_session',
    funnel: {
      entry_sessions: overview.funnel.entrySessions,
      reached_google_sessions: overview.funnel.reachedGoogleSessions,
      reached_google_percent: overview.funnel.reachedGooglePercent,
      is_empty: overview.funnel.isEmpty,
      largest_drop_index: overview.funnel.largestDropIndex,
      steps: overview.funnel.steps.map(serializeStep),
    },
    trend: {
      /** Newest local day the nightly rollup covers, or null when it has never run. */
      rollup_through: overview.rollupThrough,
      /** Completed days with no rollup behind them. Their counts are unknown, not zero. */
      pending_days: overview.pendingDays,
      days: overview.trend.map(serializeTrendDay),
    },
  });
}

function serializeStep(step: FunnelStep): Record<string, unknown> {
  return {
    event: step.event,
    label: step.label,
    description: step.description,
    sessions: step.sessions,
    share_of_entry: step.shareOfEntry,
    change: step.change,
    /**
     * Sessions lost against the previous step; negative means gained. `gained` is a real state,
     * not a bug: visitors reach the review page from the public profile or a shared link without
     * scanning a standee, so step 2 can legitimately exceed step 1 and clamping it would credit
     * a QR code that was never used.
     */
    change_sessions: step.changeSessions,
    change_percent: step.changePercent,
  };
}

function serializeTrendDay(day: TrendDay): Record<string, unknown> {
  return {
    date: day.date,
    /** True when the nightly rollup has not summarised this day. `counts` is then empty. */
    pending: day.pending,
    /** True for the tenant's current local day, which is counted live and is still filling up. */
    live: day.live,
    counts: day.counts,
  };
}

import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/lib/infra/db';
import { requireTenant } from '@/lib/tenant/require-tenant';
import { loadLinkClickAnalytics } from '@/lib/analytics/queries';
import { analyticsRangeFor, serializeRange } from '../../../../../lib/analytics/range-request';

/**
 * GET /api/v1/analytics/links — public profile link clicks for AN-01.
 *
 * The tenant is never taken from the request: `requireTenant` resolves it from the session, so
 * there is no business id in the URL or body for a caller to tamper with (RBAC rule 2, AC-003).
 *
 * Like `/analytics/qr`, this cannot read the nightly rollup: `dimension_key` holds the event name,
 * so `analytics_daily_business` has no link dimension. The counts are aggregated live from
 * `analytics_events` over the range.
 *
 * ─── THE ONE UNTRUSTED DIMENSION ON THIS SCREEN ───────────────────────────────────────────────
 *
 * `profile_link_click` carries `link_id` in its properties, and `components/customer/profile/PublicProfile.tsx`
 * sends it from the browser. The public ingestion endpoint injects `business_id` server-side, so a
 * forged payload cannot write into another tenant's analytics — but the `link_id` inside it is
 * still whatever the client said.
 *
 * So it is used only as a lookup key against `business_links` rows belonging to the resolved
 * tenant, and never rendered. An id the tenant does not own is indistinguishable in this response
 * from an id that no longer exists: both land in a single unattributed row with no label of their
 * own. That is AC-003's rule — a missing row and another tenant's row must be reported
 * identically — applied to a join rather than to a path parameter, and it is why `link_type` from
 * the same properties is not selected at all.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireTenant(request);
  if (!auth.ok) return auth.response;

  const database = db();
  const { businessId } = auth.context;

  const range = await analyticsRangeFor(database, businessId, request);
  if (!range.ok) return range.response;

  const analytics = await loadLinkClickAnalytics(database, businessId, range.range);

  return NextResponse.json({
    range: serializeRange(analytics.range),
    is_empty: analytics.isEmpty,
    // The denominator a click count needs to mean anything: twelve clicks is good against forty
    // views and poor against four thousand.
    profile_views: analytics.profileViews,
    links: analytics.links.map((link) => ({
      // Null on the unattributed row only.
      link_id: link.linkId,
      label: link.label,
      link_type: link.linkType,
      // Null on the unattributed row. A disabled link appears only when it recorded clicks, which
      // means it was visible earlier in the range — D-015 lets an owner hide a section at any time.
      is_enabled: link.isEnabled,
      clicks: link.clicks,
      // AN-01-02: distinct anonymous sessions, not people. Null on the unattributed row, because
      // adding the per-link distinct counts of several unknown ids would count one visitor once
      // per link they touched, and an inflated number is worse than an absent one.
      visitor_sessions: link.visitorSessions,
    })),
  });
}

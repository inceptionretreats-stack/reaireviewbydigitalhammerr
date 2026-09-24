import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/lib/infra/db';
import { requireTenant } from '@/lib/tenant/require-tenant';
import { loadQrSourceAnalytics } from '@/lib/analytics/queries';
import { analyticsRangeFor, serializeRange } from '../range-request';

/**
 * GET /api/v1/analytics/qr — per-source performance for AN-01's QR source table.
 *
 * The tenant is never taken from the request: `requireTenant` resolves it from the session, so
 * there is no business id in the URL or body for a caller to tamper with (RBAC rule 2, AC-003).
 * There is no `?qr_code_id=` parameter either — every source this returns is one the resolved
 * tenant owns, so there is no id for a caller to substitute and therefore no IDOR surface. When
 * QR-01's detail screen lands and needs one source at a time, the id must be ownership-checked
 * against the resolved tenant before use, and a missing source and another tenant's source must
 * answer identically.
 *
 * This one cannot read the nightly rollup. `analytics_daily_business.dimension_key` holds the
 * event name, so there is no QR dimension in it at all — the whole table has nothing to say about
 * which standee a scan came from. Every figure here is aggregated live from `analytics_events`
 * over the range, which is worth knowing before someone assumes the rollup covers this screen.
 *
 * Two rows here are not QR sources and are labelled as such rather than dropped:
 *
 *  - `qr_code_id: null` — activity that reached the review page without a QR code, from the public
 *    profile, a shared link or a review request. Dropping it would make the source figures fail to
 *    add up to the overview, with no visible reason why.
 *  - an id matching no source this tenant owns. Disabled sources are still listed (QR-01 offers
 *    disable, never delete), so in practice this means an admin-deleted row. It is reported as one
 *    unrecognised bucket and never carries a label taken from the event.
 *
 * AC-025: `google_pages_opened` counts the Google review page being opened. Nothing here counts,
 * implies or can be used to derive a review being left.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireTenant(request);
  if (!auth.ok) return auth.response;

  const database = db();
  const { businessId } = auth.context;

  const range = await analyticsRangeFor(database, businessId, request);
  if (!range.ok) return range.response;

  const analytics = await loadQrSourceAnalytics(database, businessId, range.range);

  return NextResponse.json({
    range: serializeRange(analytics.range),
    is_empty: analytics.isEmpty,
    sources: analytics.sources.map((source) => ({
      // Null on the two non-source rows above. A client rendering a link to a QR detail screen
      // must check for it rather than assume every row has one.
      qr_code_id: source.qrCodeId,
      label: source.label,
      // Null for the same rows: a bucket has no lifecycle. Present values mirror qr_codes.status,
      // so QR-01 and this screen describe a disabled standee the same way.
      status: source.status,
      scans: source.scans,
      review_pages_opened: source.reviewPagesOpened,
      drafts_created: source.draftsCreated,
      reviews_copied: source.reviewsCopied,
      google_pages_opened: source.googlePagesOpened,
      // AN-01-02: distinct anonymous sessions, not people. Counted per source, so a visitor who
      // scanned two different standees appears under both — the rows are not a partition and must
      // not be summed.
      visitor_sessions: source.visitorSessions,
    })),
  });
}

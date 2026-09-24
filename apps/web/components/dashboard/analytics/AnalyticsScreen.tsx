import { redirect } from 'next/navigation';
import { TenantGuard } from '@ai-review/core';
import { Card, InlineError } from '@ai-review/ui';
import { db } from '@/lib/infra/db';
import { getSession } from '@/lib/auth/session';
import { FunnelCard } from './FunnelCard';
import { KpiRow } from './KpiRow';
import { LinkClickTable } from './LinkClickTable';
import { QrSourceTable } from './QrSourceTable';
import { RangeFilter } from './RangeFilter';
import { TrendCard } from './TrendCard';
import { formatRangeLabel } from './format';
import {
  loadAnalyticsOverview,
  loadBusinessTimeZone,
  loadLinkClickAnalytics,
  loadQrSourceAnalytics,
} from '@/lib/analytics/queries';
import { describeRangeRejection, resolveAnalyticsRange } from '@/lib/analytics/range';

/**
 * AN-01's `data` and `empty` states.
 *
 * Split out of `page.tsx` so the page itself awaits no database work and the Suspense fallback is
 * a real `loading` state rather than a component that never renders — the same division
 * `components/dashboard/overview/DashboardOverview.tsx` draws for DASH-01.
 *
 * The tenant is resolved here, not in the layout: the layout has no use for one and resolving it
 * twice would be two round trips for a single answer. Nothing in this tree takes a business id
 * from the request — `TenantGuard.resolveActive` derives it from the session, which is AC-003 and
 * RBAC rule 2. The only request input is a date range, and it is validated before it reaches a
 * query.
 *
 * The three loads run together because they are independent and the screen cannot render until it
 * has all of them; serialising would only add latency.
 *
 * AN-01 also lists `Export CSV` as an optional V1 flag. It is NOT built: a CSV of these figures
 * needs the same compliance wording as the screen — a column header that says the wrong thing
 * travels further than a label, because a spreadsheet outlives its caption — and it is flagged
 * optional precisely so it can wait. When it is built it belongs behind the same three endpoints.
 */

export interface AnalyticsScreenProps {
  /** Raw `?from=` value, straight from the URL. Validated here, never trusted. */
  from: string | null;
  /** Raw `?to=` value. */
  to: string | null;
  /** Route the filter form submits back to. */
  action: string;
}

export async function AnalyticsScreen({ from, to, action }: AnalyticsScreenProps) {
  const session = await getSession();

  // The layout has already redirected an anonymous caller. Repeated because this component reads
  // tenant data and must not depend on a parent's guard for that; it also narrows the type.
  if (!session) redirect('/login');

  const database = db();
  const tenant = await new TenantGuard(database).resolveActive(session);
  if (!tenant.ok) return <NoBusinessFound />;

  const timeZone = await loadBusinessTimeZone(database, tenant.businessId);
  if (timeZone === null) return <NoBusinessFound />;

  const now = new Date();
  const resolution = resolveAnalyticsRange({ from, to, timeZone, now });

  // A rejected range still renders the screen, on the default range, with the message beside the
  // fields that produced it. Replacing the whole screen with an error would throw away the numbers
  // the owner already had in front of them over one mistyped date.
  const usable = resolution.ok ? resolution : resolveAnalyticsRange({ timeZone, now });
  if (!usable.ok) return <RangeUnavailable />;

  const range = usable.range;
  const rangeError = resolution.ok ? null : describeRangeRejection(resolution.reason);
  const rangeLabel = formatRangeLabel(range.from, range.to, range.timeZone);

  const [overview, qr, links] = await Promise.all([
    loadAnalyticsOverview(database, tenant.businessId, range),
    loadQrSourceAnalytics(database, tenant.businessId, range),
    loadLinkClickAnalytics(database, tenant.businessId, range),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold tracking-wider text-ink-muted uppercase">Analytics</p>
        <h1 className="text-2xl font-bold tracking-tight text-ink">
          How customers are using your review page
        </h1>
        <p className="max-w-prose text-sm text-ink-muted">
          Everything here is counted in <strong>{range.timeZone}</strong>, your business timezone,
          so a day starts and ends when your business does.
          {range.usedDefaultTimeZone &&
            ' Your saved timezone could not be recognised, so this is the default — you can correct it in your business profile.'}
        </p>
      </div>

      {range.clampedFuture && (
        <p className="text-sm text-ink-muted">
          Dates after today were adjusted: there is nothing to show for a day that has not happened.
        </p>
      )}

      {range.beyondEventRetention && (
        <p className="text-sm text-ink-muted">
          Part of this range is older than 13 months. Daily summaries go back further than the
          detailed records behind the funnel and the tables, so those may read lower for the oldest
          days.
        </p>
      )}

      <RangeFilter range={range} action={action} error={rangeError} />

      <KpiRow totals={overview.totals} uniqueVisitorSessions={overview.uniqueVisitorSessions} />

      <FunnelCard funnel={overview.funnel} rangeLabel={rangeLabel} />

      <TrendCard days={overview.trend} rangeLabel={rangeLabel} timeZone={range.timeZone} />

      <QrSourceTable sources={qr.sources} isEmpty={qr.isEmpty} rangeLabel={rangeLabel} />

      <LinkClickTable
        links={links.links}
        profileViews={links.profileViews}
        isEmpty={links.isEmpty}
        rangeLabel={rangeLabel}
      />
    </div>
  );
}

/**
 * A live session with no business behind it.
 *
 * Rendered rather than redirected, for the reason `DashboardOverview` gives: `/login` sends a
 * `BUSINESS_OWNER` straight back to `/app`, so redirecting would bounce the browser between two
 * routes forever, and the one role this can legitimately happen to owns no business by design.
 */
function NoBusinessFound() {
  return (
    <Card title="We could not find your business" titleAs="h2">
      <p className="text-sm text-ink-muted">
        This account is signed in but no business is attached to it, so there is nothing to measure.
        Please contact Digital Hammerr — this is not something you can fix from this screen.
      </p>
    </Card>
  );
}

/**
 * Unreachable in practice: the fallback range takes no input, so the only way it fails is an
 * unusable clock. Rendered rather than thrown so the dashboard does not 500 over it.
 */
function RangeUnavailable() {
  return (
    <Card title="Analytics are unavailable" titleAs="h2">
      {/* role="status" rather than the default alert: this is present on first render, not a
          response to something the owner just did. */}
      <InlineError role="status">
        We could not work out a date range to show. Please reload the page, and contact Digital
        Hammerr if it keeps happening.
      </InlineError>
    </Card>
  );
}

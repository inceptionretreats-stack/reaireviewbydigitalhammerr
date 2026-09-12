import { KpiCard } from '@ai-review/ui';
import { describePlan, describeQrSources } from './presentation';
import type { DashboardQrSources, DashboardSummary } from './summary';

/**
 * The only two figures on this screen that are counts of something real today.
 *
 * Deliberately not a full KPI row. DASH-01 lists scans, generations, copies and Google opens as
 * well, and every one of those comes from `analytics_daily_business`, which nothing aggregates
 * into yet. Cards showing zero would be read as "nobody used it" rather than "not measured yet",
 * which is a worse lie than a missing card.
 *
 * No `trend` is passed for the same reason: a trend needs a previous period to compare against.
 *
 * DASH-01-02 constrains what may appear here at all. Neither figure is derived from a `google_open`
 * event, and no figure on this screen counts anything the platform cannot observe — the product
 * only ever knows that the Google review page was opened (D-028, AC-025).
 */

export interface LiveFiguresProps {
  qrSources: DashboardQrSources;
  subscription: DashboardSummary['subscription'];
  /**
   * The business lifecycle state, because "active" is a property of the source *and* of the tenant:
   * `lib/public-business.ts` resolves a QR only for an ACTIVE business, so on a DRAFT, SUSPENDED or
   * CLOSED tenant no source is scanning whatever these counts say.
   */
  businessStatus: DashboardSummary['business']['status'];
}

export function LiveFigures({ qrSources, subscription, businessStatus }: LiveFiguresProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <KpiCard
        className="dashboard-kpi dashboard-kpi--green"
        label="Enabled QR sources"
        value={qrSources.active}
        hint={describeQrSources(qrSources, businessStatus)}
      />
      {subscription && <GenerationAllowance subscription={subscription} />}
    </div>
  );
}

/**
 * The lifetime Free allowance or the independent annual Pro allowance.
 */
function GenerationAllowance({
  subscription,
}: {
  subscription: NonNullable<DashboardSummary['subscription']>;
}) {
  const plan = describePlan(subscription.status);

  const isPro = plan.quotaKind === 'PRO';
  const used = isPro ? subscription.proGenerationsUsed : subscription.freeGenerationsUsed;
  const limit = isPro ? subscription.proGenerationLimit : subscription.freeGenerationLimit;
  const remaining = limit - used;

  return (
    <KpiCard
      className="dashboard-kpi dashboard-kpi--blue"
      label={isPro ? 'Pro Ai drafts used this year' : 'Free Ai drafts used'}
      value={`${used.toLocaleString('en-IN')} of ${limit.toLocaleString('en-IN')}`}
      hint={
        remaining > 0
          ? `${remaining.toLocaleString('en-IN')} left${isPro ? ' this subscription year' : ''}.`
          : // 02_System_Architecture is explicit that an exhausted quota must never block the
            // direct Google button. An owner who reads "none left" as "my page is dead" would
            // take the standees down.
            'None left. Customers can still open Google straight from your page.'
      }
    />
  );
}

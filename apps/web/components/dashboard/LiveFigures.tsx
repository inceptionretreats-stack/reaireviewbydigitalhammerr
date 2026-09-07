import { KpiCard } from '@ai-review/ui';
import { describePlan } from './presentation';
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
}

export function LiveFigures({ qrSources, subscription }: LiveFiguresProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <KpiCard label="Active QR sources" value={qrSources.active} hint={qrSourceHint(qrSources)} />
      {subscription && <GenerationAllowance subscription={subscription} />}
    </div>
  );
}

function qrSourceHint(qrSources: DashboardQrSources): string {
  // D-026: every QR is dynamic, and publishing creates the first one. Saying so turns a zero from
  // something that looks broken into the next thing to do.
  if (qrSources.total === 0) return 'Your first QR code is created when you publish.';
  if (qrSources.disabled === 1) return '1 more is disabled.';
  if (qrSources.disabled > 1) return `${qrSources.disabled} more are disabled.`;
  return 'Every source you have created is working.';
}

/**
 * The free allowance (D-004, AC-013), or what replaces it on a paid plan.
 *
 * `free_generations_used` keeps incrementing after an upgrade, so on Pro it is a historical figure
 * and not a ceiling. Presenting it as "3 of 10" to a paying tenant would tell them they are about
 * to run out of something they have already bought their way past.
 */
function GenerationAllowance({
  subscription,
}: {
  subscription: NonNullable<DashboardSummary['subscription']>;
}) {
  const plan = describePlan(subscription.status);

  if (!plan.freeQuotaGoverns) {
    const fairUse = subscription.fairUseMonthlySoftLimit;
    return (
      <KpiCard
        label="AI generations"
        value="Included"
        hint={
          fairUse === null
            ? 'Covered by your plan.'
            : `Covered by your plan, up to a fair-use limit of ${fairUse} a month.`
        }
      />
    );
  }

  // ck_free_used_within_limit makes this non-negative at the database level, so there is nothing
  // to clamp.
  const remaining = subscription.freeGenerationLimit - subscription.freeGenerationsUsed;

  return (
    <KpiCard
      label="Free AI generations used"
      value={`${subscription.freeGenerationsUsed} of ${subscription.freeGenerationLimit}`}
      hint={
        remaining > 0
          ? `${remaining} left.`
          : // 02_System_Architecture is explicit that an exhausted quota must never block the
            // direct Google button. An owner who reads "none left" as "my page is dead" would
            // take the standees down.
            'None left. Customers can still open Google straight from your page.'
      }
    />
  );
}

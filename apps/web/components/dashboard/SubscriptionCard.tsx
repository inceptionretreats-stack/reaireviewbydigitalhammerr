import Link from 'next/link';
import { Card, InlineError, StatusBadge } from '@ai-review/ui';
import { describePlan, formatDate, formatMoney } from './presentation';
import type { DashboardSummary } from './summary';

/**
 * Subscription status, the one item on DASH-01's list that needs no analytics to be true.
 *
 * The upgrade itself lives on SUB-01 (`/app/subscription`), where Razorpay checkout runs with
 * server-side signature verification (CHANGE-004). This card links there rather than opening
 * checkout itself, so there is one place that knows how a payment is started and confirmed.
 *
 * Price is shown to a free tenant as what Pro costs, and to a paying one as what they pay. Same
 * number from the same column either way — `subscriptions.amount_paise` is per-tenant, so a
 * grandfathered price stays correct here.
 */

export interface SubscriptionCardProps {
  subscription: DashboardSummary['subscription'];
  /** Business-local timezone, so a renewal date is the date the owner would say it is (AC-026). */
  timezone: string;
}

export function SubscriptionCard({ subscription, timezone }: SubscriptionCardProps) {
  if (!subscription) {
    // Signup creates this row in the same transaction as the business, so its absence is a broken
    // invariant rather than a state to design for. Reported plainly: nothing on this screen can
    // repair it, and quietly rendering "Free" would misstate the tenant's entitlement.
    return (
      <Card
        title="Subscription"
        titleAs="h2"
        className="dashboard-section-card dashboard-section-card--yellow"
      >
        <InlineError role="status">
          We could not find a plan for this business. Please contact Digital Hammerr.
        </InlineError>
      </Card>
    );
  }

  const plan = describePlan(subscription.status);
  const validUntil = formatDate(subscription.expiresAt, timezone);
  const price = formatMoney(subscription.amountPaise, subscription.currency);
  const proAllowance = subscription.proGenerationLimit.toLocaleString('en-IN');

  return (
    <Card
      title="Subscription"
      titleAs="h2"
      className="dashboard-section-card dashboard-section-card--yellow"
    >
      <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-2 text-sm">
        <dt className="text-ink-muted">Plan</dt>
        <dd>
          <StatusBadge status={plan.badge} label={plan.label} />
        </dd>

        <dt className="text-ink-muted">{plan.badge === 'PRO' ? 'You pay' : 'Pro costs'}</dt>
        <dd className="font-medium tabular-nums text-ink">{price} per year</dd>

        <dt className="text-ink-muted">Pro allowance</dt>
        <dd className="font-medium tabular-nums text-ink">{proAllowance} Ai drafts per year</dd>

        {validUntil && (
          <>
            <dt className="text-ink-muted">Valid until</dt>
            <dd className="font-medium text-ink">{validUntil}</dd>
          </>
        )}
      </dl>

      <p className="mt-3 text-sm text-ink-muted">{plan.note}</p>
      <p className="mt-2 text-sm">
        <Link
          href="/app/subscription"
          className="font-medium text-ink underline underline-offset-2"
        >
          {plan.badge === 'PRO' ? 'Manage your plan' : 'Upgrade to Pro'}
        </Link>
      </p>
    </Card>
  );
}

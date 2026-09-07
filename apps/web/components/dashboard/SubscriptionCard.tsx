import { Card, InlineError, StatusBadge } from '@ai-review/ui';
import { describePlan, formatDate, formatMoney } from './presentation';
import type { DashboardSummary } from './summary';

/**
 * Subscription status, the one item on DASH-01's list that needs no analytics to be true.
 *
 * There is no Upgrade or Renew button, though the screen spec lists one: SUB-01 does not exist
 * yet, and Razorpay checkout requires server-side signature verification that is still open
 * (OPEN-03). A button that cannot complete the purchase, or a disabled one with no explanation,
 * both cost more trust than a sentence saying where the flow currently is.
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
      <Card title="Subscription" titleAs="h2">
        <InlineError role="status">
          We could not find a plan for this business. Please contact Digital Hammerr.
        </InlineError>
      </Card>
    );
  }

  const plan = describePlan(subscription.status);
  const validUntil = formatDate(subscription.expiresAt, timezone);
  const price = formatMoney(subscription.amountPaise, subscription.currency);

  return (
    <Card title="Subscription" titleAs="h2">
      <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-2 text-sm">
        <dt className="text-ink-muted">Plan</dt>
        <dd>
          <StatusBadge status={plan.badge} label={plan.label} />
        </dd>

        <dt className="text-ink-muted">{plan.badge === 'PRO' ? 'You pay' : 'Pro costs'}</dt>
        <dd className="font-medium tabular-nums text-ink">{price} per year</dd>

        {validUntil && (
          <>
            <dt className="text-ink-muted">Valid until</dt>
            <dd className="font-medium text-ink">{validUntil}</dd>
          </>
        )}
      </dl>

      <p className="mt-3 text-sm text-ink-muted">{plan.note}</p>
      <p className="mt-1 text-sm text-ink-muted">
        Upgrading and renewing are not available in the dashboard yet.
      </p>
    </Card>
  );
}

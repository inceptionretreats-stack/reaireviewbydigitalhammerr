import { Badge } from '@ai-review/ui';

/**
 * 19_Admin_Panel_Spec: "Manual entitlement change must be visually distinct from paid
 * entitlement." A paid year and a granted year are both Pro to the customer and different to
 * the business — one earned revenue, one is a decision someone made and should be able to find.
 */
export function PlanBadge({
  row,
}: {
  row: { plan: 'FREE' | 'PRO'; entitlementSource: string; subscriptionStatus: string };
}) {
  if (row.plan !== 'PRO') {
    return (
      <Badge tone="neutral">
        {row.subscriptionStatus === 'CANCELLED' || row.subscriptionStatus === 'EXPIRED'
          ? `Free (${row.subscriptionStatus.toLowerCase()} Pro)`
          : 'Free'}
      </Badge>
    );
  }
  if (row.entitlementSource === 'ADMIN')
    return <Badge tone="warning">Pro — granted by admin</Badge>;
  if (row.subscriptionStatus === 'PAST_DUE')
    return <Badge tone="warning">Pro — payment overdue</Badge>;
  return <Badge tone="success">Pro — paid</Badge>;
}

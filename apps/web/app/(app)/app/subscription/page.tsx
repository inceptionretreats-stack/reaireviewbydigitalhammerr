import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { TenantGuard } from '@ai-review/core';
import { Card } from '@ai-review/ui';
import { db } from '@/lib/db';
import { getSession } from '@/lib/session';
import { loadSubscriptionView } from '@/lib/subscription';
import { formatDate, formatMoney } from '@/components/dashboard/presentation';
import { PaymentHistory } from '@/components/dashboard/subscription/PaymentHistory';
import { SubscriptionPanel } from '@/components/dashboard/subscription/SubscriptionPanel';

/**
 * SUB-01 — `/app/subscription`.
 *
 * A Server Component that reads the plan and hands the client panel preformatted values: the
 * dates are rendered in the business timezone here (AC-026) and the price is the platform
 * setting, so the button says what checkout will actually charge.
 *
 * Nothing here takes an identifier from the request. The session supplies the user,
 * `TenantGuard` derives the business, and the checkout, verify and receipt routes resolve the
 * business the same way (RBAC rule 2, AC-003).
 */

export const metadata: Metadata = {
  title: 'Subscription | Ai Review',
  description: 'Your plan, what it includes, and your payment history.',
};

export const dynamic = 'force-dynamic';

export default async function Page() {
  const session = await getSession();
  if (!session) redirect('/login');

  const database = db();
  const tenant = await new TenantGuard(database).resolveActive(session);
  if (!tenant.ok) return <NoPlanFound />;

  const view = await loadSubscriptionView(database, tenant.businessId);
  if (!view) return <NoPlanFound />;

  const timezone = view.business.timezone;

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold tracking-wider text-ink-muted uppercase">
          Subscription
        </p>
        <h1 className="text-2xl font-bold tracking-tight text-ink">Your plan</h1>
        <p className="text-sm text-ink-muted">
          Ten Ai review drafts are free for life. Pro is {formatMoney(view.pricePaise, 'INR')} a
          year for up to {view.plan.proGenerationLimit.toLocaleString('en-IN')} drafts.
        </p>
      </div>

      <SubscriptionPanel
        status={view.plan.status}
        source={view.plan.source}
        startsAt={formatDate(view.plan.startsAt, timezone)}
        expiresAt={formatDate(view.plan.expiresAt, timezone)}
        price={formatMoney(view.pricePaise, 'INR')}
        proAllowance={view.plan.proGenerationLimit.toLocaleString('en-IN')}
        usage={view.usage}
        paymentsConfigured={view.paymentsConfigured}
        renewal={view.renewal}
        businessActive={tenant.status === 'ACTIVE'}
      />

      <PaymentHistory payments={view.payments} timezone={timezone} />
    </div>
  );
}

function NoPlanFound() {
  return (
    <Card title="We could not load your plan" titleAs="h2">
      <p className="text-sm text-ink-muted">
        This account is signed in but we could not find a plan for the business attached to it.
        Please contact Digital Hammerr — this is not something you can fix from this screen.
      </p>
    </Card>
  );
}

import { redirect } from 'next/navigation';
import { TenantGuard } from '@ai-review/core';
import { Card, StatusBadge } from '@ai-review/ui';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { getSession } from '@/lib/session';
import { LiveFigures } from './LiveFigures';
import { PublicPageCard } from './PublicPageCard';
import { ReportingCard } from './ReportingCard';
import { SetupProgressCard } from './SetupProgressCard';
import { SubscriptionCard } from './SubscriptionCard';
import { describeBusinessStatus, formatDate } from './presentation';
import { loadDashboardSummary } from './summary';

/**
 * DASH-01's `data` state.
 *
 * Split out of `page.tsx` so the page itself awaits nothing and the Suspense fallback is a real
 * loading state rather than a component that never renders.
 *
 * The tenant is resolved here rather than in the layout because the layout has no use for it and
 * resolving it twice would be two round trips for one answer — the same division
 * `app/(app)/onboarding/layout.tsx` already draws. Nothing in this tree takes a business id from
 * the request: `TenantGuard.resolveActive` derives it from the session, which is what AC-003 and
 * RBAC rule 2 require.
 */
export async function DashboardOverview() {
  const session = await getSession();

  // The layout has already redirected an anonymous caller. Repeated here because this component
  // reads tenant data and must not depend on a parent's guard for that; it also narrows the type.
  if (!session) redirect('/login');

  const database = db();
  const tenant = await new TenantGuard(database).resolveActive(session);
  if (!tenant.ok) return <NoBusinessFound />;

  const summary = await loadDashboardSummary(database, tenant.businessId);
  if (!summary) return <NoBusinessFound />;

  const status = describeBusinessStatus(summary.business.status);
  const publicUrl = summary.slug
    ? new URL(`/${summary.slug}`, env().APP_BASE_URL).toString()
    : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold tracking-wider text-ink-muted uppercase">Dashboard</p>
        <h1 className="text-2xl font-bold tracking-tight text-ink">{summary.business.name}</h1>
        <StatusBadge status={status.badge} label={status.label} className="self-start" />
      </div>

      {/* Setup comes first while it is unfinished: nothing else on the screen matters until the
          page is live, and an owner who lands here mid-onboarding needs the way back in. */}
      {!summary.progress.isPublished && <SetupProgressCard progress={summary.progress} />}

      <LiveFigures qrSources={summary.qrSources} subscription={summary.subscription} />

      <div className="grid gap-4 lg:grid-cols-2">
        <PublicPageCard
          publicUrl={publicUrl}
          isLive={status.isPubliclyLive}
          statusNote={status.note}
          liveSince={
            status.isPubliclyLive
              ? formatDate(summary.business.publishedAt, summary.business.timezone)
              : null
          }
        />
        <SubscriptionCard
          subscription={summary.subscription}
          timezone={summary.business.timezone}
        />
      </div>

      <ReportingCard />
    </div>
  );
}

/**
 * A live session with no business behind it.
 *
 * `lib/require-tenant.ts` calls this a broken invariant rather than a normal state, and it is:
 * signup creates the business in the same transaction as the user. It is rendered rather than
 * redirected on purpose. `/login` sends a `BUSINESS_OWNER` straight back to `/app`
 * (`landingPathFor`), so redirecting there would bounce the browser between two routes forever —
 * and the one role this can legitimately happen to, `BUSINESS_SUPPORT_VIEWER`, owns no business by
 * design and would be the one caught in it.
 */
function NoBusinessFound() {
  return (
    <Card title="We could not find your business" titleAs="h2">
      <p className="text-sm text-ink-muted">
        This account is signed in but no business is attached to it, so there is nothing to show
        here. Please contact Digital Hammerr — this is not something you can fix from this screen.
      </p>
    </Card>
  );
}

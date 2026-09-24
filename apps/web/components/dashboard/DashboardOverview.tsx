import Link from 'next/link';
import { redirect } from 'next/navigation';
import { TenantGuard, buildQrUrl } from '@ai-review/core';
import { Card, StatusBadge } from '@ai-review/ui';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { getSession } from '@/lib/session';
import { qrDataUri } from '@/lib/qr-image';
import { FirstStepsCard } from './FirstStepsCard';
import { LiveFigures } from './LiveFigures';
import { PublicPageCard } from './PublicPageCard';
import { ReportingCard } from './ReportingCard';
import { SetupProgressCard } from './SetupProgressCard';
import { SubscriptionCard } from './SubscriptionCard';
import { describeBusinessStatus, formatDate } from './presentation';
import { loadDashboardSummary } from './summary';
import { PRIMARY_LINK, SECONDARY_LINK } from './link-styles';

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

  // Only encoded when it is about to be shown. A tenant that has been scanned — every established
  // one — pays nothing for guidance it has outgrown.
  const showFirstSteps = status.isPubliclyLive && !summary.hasBeenScanned;
  const firstStepsQr =
    showFirstSteps && summary.primaryQr
      ? await qrDataUri(buildQrUrl(env().APP_BASE_URL, summary.primaryQr.code))
      : null;
  const publicUrl = summary.slug
    ? new URL(`/${summary.slug}`, env().APP_BASE_URL).toString()
    : null;

  return (
    <div className="vendor-overview flex flex-col gap-6">
      <header className="vendor-overview-header flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="vendor-title-row">
            <h1 className="text-2xl font-bold tracking-tight break-words text-ink">
              {summary.business.name}
            </h1>
            <StatusBadge status={status.badge} label={status.label} className="self-start" />
          </div>
          <p className="vendor-overview-description">Your review experience, all in one place.</p>
        </div>
        <div className="vendor-overview-actions flex flex-wrap items-center gap-2">
          <Link href="/app/qr" className={PRIMARY_LINK}>
            Manage QR codes
          </Link>
          <Link href="/app/ai-review" className={SECONDARY_LINK}>
            Edit Ai context
          </Link>
        </div>
      </header>

      {/* Setup comes first while it is unfinished: nothing else on the screen matters until the
          page is live, and an owner who lands here mid-onboarding needs the way back in.
          Gated on DRAFT specifically — a SUSPENDED or CLOSED tenant HAS published, and telling it
          that its page "starts working the moment you publish" would be both wrong and useless.
          Those states are explained by the status badge above. */}
      {summary.progress.status === 'DRAFT' && <SetupProgressCard progress={summary.progress} />}

      {/* The counterpart to SetupProgressCard, on the other side of publish. That card gets an
          owner to a live page; this one gets the live page to a customer, which is the step no
          amount of configuration can complete. Both are transient by design. */}
      {showFirstSteps && (
        <FirstStepsCard
          businessName={summary.business.name}
          qrPreviewSrc={firstStepsQr}
          qrCode={summary.primaryQr?.code ?? null}
          qrDownloadId={summary.primaryQr?.id ?? null}
        />
      )}

      {/* The lifecycle state goes in because a count of enabled sources says nothing about whether
          any of them resolves: only an ACTIVE business does (lib/public-business.ts, Flow J). */}
      <LiveFigures
        qrSources={summary.qrSources}
        subscription={summary.subscription}
        businessStatus={summary.business.status}
      />

      <div className="vendor-overview-panels grid gap-4 lg:grid-cols-2">
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

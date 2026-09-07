import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { TenantGuard } from '@ai-review/core';
import { Card } from '@ai-review/ui';
import { db } from '@/lib/db';
import { getSession } from '@/lib/session';
import { AccountDetailsForm } from '@/components/dashboard/settings/AccountDetailsForm';
import { BusinessStatusCard } from '@/components/dashboard/settings/BusinessStatusCard';
import { PasswordChangeForm } from '@/components/dashboard/settings/PasswordChangeForm';
import { SessionsCard } from '@/components/dashboard/settings/SessionsCard';
import { loadAccountSettings } from '@/components/dashboard/settings/account';

/**
 * SET-01 — `/app/settings`.
 *
 * A Server Component that reads the account and hands it to the forms as initial values, for the
 * reason `onboarding/business/page.tsx` gives: fetching on mount would show an owner three empty
 * boxes that fill in a moment later, and they can type into them during the gap.
 *
 * Nothing here takes an identifier from the request. The session supplies the user, `TenantGuard`
 * derives the business from it, and every write below goes to an endpoint that resolves both the
 * same way (RBAC rule 2, AC-003).
 *
 * No Suspense boundary, unlike `/app`. DASH-01 lists a `loading` state and this screen does not —
 * its three states are `default`, `saved` and `error`, and each card owns its own.
 *
 * One column with a reading-width cap: these are forms, and a label-above-control field stretched
 * across a wide desktop is harder to follow than one that stays near its label.
 */

export const metadata: Metadata = {
  title: 'Settings | AI Review',
  description: 'Your name, email, mobile, password and where you are signed in.',
};

export default async function Page() {
  const session = await getSession();
  // The layout has already redirected an anonymous caller. Repeated because this page reads account
  // data and must not depend on a parent's guard having run; it also narrows the type.
  if (!session) redirect('/login');

  const database = db();
  const tenant = await new TenantGuard(database).resolveActive(session);
  if (!tenant.ok) return <NoBusinessFound />;

  const settings = await loadAccountSettings(
    database,
    session.userId,
    session.sessionId,
    tenant.businessId,
  );
  if (!settings) return <NoBusinessFound />;

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold tracking-wider text-ink-muted uppercase">Settings</p>
        <h1 className="text-2xl font-bold tracking-tight text-ink">Your account</h1>
        <p className="text-sm text-ink-muted">
          Details we hold for you, your password, and the sessions signed in to this account.
        </p>
      </div>

      <AccountDetailsForm initial={settings.account} />
      <PasswordChangeForm />
      <SessionsCard otherSessions={settings.otherLiveSessions} />
      <BusinessStatusCard business={settings.business} />
    </div>
  );
}

/**
 * A live session with no business behind it, or with the row missing underneath one.
 *
 * Rendered rather than redirected, for the reason `DashboardOverview` states: `/login` sends a
 * BUSINESS_OWNER straight back into `/app`, so redirecting there would bounce the browser between
 * two routes. The account fields are hidden along with the rest because this screen loads them in
 * the same query, and a partial settings screen invites an owner to save over a broken state.
 */
function NoBusinessFound() {
  return (
    <Card title="We could not load your settings" titleAs="h2">
      <p className="text-sm text-ink-muted">
        This account is signed in but we could not find the business attached to it, so there is
        nothing to show here. Please contact Digital Hammerr — this is not something you can fix
        from this screen.
      </p>
    </Card>
  );
}

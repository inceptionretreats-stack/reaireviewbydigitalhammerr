import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { users } from '@ai-review/db';
import { isAdminRole } from '@ai-review/core';
import { MfaChallengeForm } from '@/components/auth/MfaChallengeForm';
import { db } from '@/lib/infra/db';
import { getSession } from '@/lib/auth/session';

export const metadata: Metadata = { title: 'Confirm it is you | Ai Review' };
export const dynamic = 'force-dynamic';

/**
 * AMENDMENT-027 — the MFA challenge. Reachable only by a pending admin session: a stranger is
 * sent to sign in, an owner to their dashboard, an admin who has already passed to /admin, and
 * an admin with nothing enrolled to enrolment.
 */
export default async function Page() {
  const session = await getSession();
  if (!session) redirect('/login');
  if (!isAdminRole(session.role)) redirect('/app');
  if (session.mfaVerifiedAt) redirect('/admin');
  if (!session.mfaEnabledAt) redirect('/login/mfa/enrol');

  const [account] = await db()
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1);

  return <MfaChallengeForm account={account?.email ?? 'your account'} />;
}

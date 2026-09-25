import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { isAdminRole } from '@ai-review/core';
import { MfaEnrolWizard } from '@/components/auth/MfaEnrolWizard';
import { getSession } from '@/lib/auth/session';

export const metadata: Metadata = { title: 'Set up your authenticator | Ai Review' };
export const dynamic = 'force-dynamic';

/** AMENDMENT-027 — forced enrolment for an admin role with no authenticator yet. */
export default async function Page() {
  const session = await getSession();
  if (!session) redirect('/login');
  if (!isAdminRole(session.role)) redirect('/app');
  if (session.mfaEnabledAt) redirect(session.mfaVerifiedAt ? '/admin' : '/login/mfa');

  return <MfaEnrolWizard />;
}

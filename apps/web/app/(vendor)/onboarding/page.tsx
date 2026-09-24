import { redirect } from 'next/navigation';
import { TenantGuard } from '@ai-review/core';
import { db } from '@/lib/infra/db';
import { getSession } from '@/lib/auth/session';
import { loadOnboardingProgress } from '@/lib/onboarding/progress';
import { resumeStep } from '@/lib/onboarding/steps';

/**
 * GET /onboarding — sends an owner to the first step still needing attention.
 *
 * Exists so that "continue setting up" is a single stable link from anywhere: the dashboard, an
 * email, a bookmark. Which step that is gets derived on each visit, so a link shared or saved
 * earlier never lands on a step already completed.
 */
export default async function OnboardingIndex() {
  const session = await getSession();
  if (!session) redirect('/login');

  const database = db();
  const tenant = await new TenantGuard(database).resolveActive(session);
  if (!tenant.ok) redirect('/login');

  const progress = await loadOnboardingProgress(database, tenant.businessId);
  redirect(resumeStep(progress).path);
}

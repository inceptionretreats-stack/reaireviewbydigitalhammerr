import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { reviewDestinations } from '@ai-review/db';
import { TenantGuard, describeReviewUrlRejection, validateGoogleReviewUrl } from '@ai-review/core';
import { db } from '@/lib/db';
import { getSession } from '@/lib/session';
import { ReviewLinkStep, type ReviewLinkCheck } from '@/components/onboarding/ReviewLinkStep';

/**
 * ONB-02 — `/onboarding/review-link`.
 *
 * Reads the stored URL on the server and hands it to the step, so a merchant returning to change
 * their link (AC-017) sees the current value immediately rather than an empty box that fills in
 * after a client fetch — on this field, a momentarily blank box reads as "my link is gone".
 *
 * No step-order guard here on purpose. `reachableSteps` exists for that, but this screen needs
 * nothing from ONB-01 beyond a tenant, and bouncing someone back would depend on how a different
 * screen decides its own step is complete. The cost of being wrong is asymmetric: an over-eager
 * redirect makes this step unreachable, while arriving early is harmless. `/onboarding` already
 * resumes at the earliest incomplete step, and the shell's Back link points at ONB-01.
 */

export const metadata: Metadata = {
  title: 'Your Google review link | AI Review',
  description: 'Set the Google page customers are sent to after copying their review.',
};

/**
 * Server-side validation that deliberately does not persist.
 *
 * ONB-02 lists "Validate link" as its own action, and `validateGoogleReviewUrl` is authoritative
 * (ONB-02-02 restricts the host set). A Server Action rather than a new endpoint because the only
 * alternative available to the browser is the PUT, and every PUT bumps `config_version` to
 * invalidate cached public configuration (AC-017) — validation must not churn that cache, and the
 * spec separates `valid` from `saved` for the same reason.
 *
 * It resolves no tenant and touches no database, which is what makes it safe to expose without one:
 * it is a pure function of the string the caller already has, returns nothing the caller did not
 * supply, and has no side effect to abuse. Keep it that way — the moment it reads tenant data it
 * needs `requireTenant`.
 */
async function checkReviewUrl(url: string): Promise<ReviewLinkCheck> {
  'use server';

  const result = validateGoogleReviewUrl(url);

  return result.ok
    ? { ok: true, url: result.url, host: result.host }
    : { ok: false, reason: result.reason, message: describeReviewUrlRejection(result.reason) };
}

export default async function Page() {
  const session = await getSession();
  if (!session) redirect('/login');

  const database = db();
  const tenant = await new TenantGuard(database).resolveActive(session);
  if (!tenant.ok) redirect('/login');

  // review_destinations owns the URL (AMENDMENT-003); the GOOGLE_REVIEW row in business_links is a
  // presentation row with no url of its own, so reading it here would always show nothing.
  const [destination] = await database
    .select({ url: reviewDestinations.url })
    .from(reviewDestinations)
    .where(
      and(
        eq(reviewDestinations.businessId, tenant.businessId),
        eq(reviewDestinations.isPrimary, true),
      ),
    )
    .limit(1);

  return <ReviewLinkStep savedUrl={destination?.url ?? null} checkUrl={checkReviewUrl} />;
}

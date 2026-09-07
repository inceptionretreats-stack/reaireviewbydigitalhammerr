import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { reviewDestinations } from '@ai-review/db';
import {
  TenantGuard,
  classifyReviewDestination,
  describeReviewUrlRejection,
  validateGoogleReviewUrl,
} from '@ai-review/core';
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
 * No step-order guard here on purpose. This screen needs nothing from ONB-01 beyond a tenant, and
 * bouncing someone back would depend on how a different screen decides its own step is complete.
 * The cost of being wrong is asymmetric: an over-eager redirect makes this step unreachable, while
 * arriving early is harmless. `/onboarding` already resumes at the first step that actually blocks
 * publishing (`resumeStep`), and the shell's Back link points at ONB-01.
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
 * It resolves no tenant and touches no database — it is a pure function of the string the caller
 * already has, and returns nothing the caller did not supply — but it still resolves a session
 * first. A Server Action is a publicly invocable POST keyed by its action id, so it inherits none
 * of this screen's guards: not the layout's `getSession`, not the page's `TenantGuard`, not the
 * rate limiter the route handlers sit behind. The check keeps unauthenticated server compute off
 * the endpoint and, more usefully, keeps a future edit that reads tenant data from doing so behind
 * an unguarded entry point. The moment it reads tenant data it needs `requireTenant` as well.
 */
async function checkReviewUrl(url: string): Promise<ReviewLinkCheck> {
  'use server';

  const session = await getSession();
  if (!session) {
    // Thrown rather than returned as a rejection. Every `ReviewLinkCheck` rejection has to name one
    // of the four validator reasons, so returning one would tell a merchant whose session expired
    // mid-form that a perfectly good link "does not look like a web address". A thrown check is
    // already handled as advisory by the step ("we could not check your link just now — you can
    // still press Continue"), which keeps their pasted link on screen, and it tells an anonymous
    // caller nothing that a dropped connection would not. The message names no detail (AC-030).
    throw new Error('A session is required to check a review link');
  }

  const result = validateGoogleReviewUrl(url);

  return result.ok
    ? { ok: true, url: result.url, host: result.host, kind: result.kind }
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

  // Classified here rather than in the client: the function is pure, but importing a value from
  // the @ai-review/core barrel into a client component drags the whole package toward the browser
  // bundle — which is how PasswordHasher nearly ended up there once already.
  const savedUrlKind = destination?.url ? classifyReviewDestination(destination.url) : null;

  return (
    <ReviewLinkStep
      savedUrl={destination?.url ?? null}
      savedUrlKind={savedUrlKind}
      checkUrl={checkReviewUrl}
    />
  );
}

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { and, asc, eq } from 'drizzle-orm';
import {
  aiBusinessContexts,
  businessLinks,
  businessSlugs,
  businesses,
  qrCodes,
  reviewModes,
} from '@ai-review/db';
import { TenantGuard, buildQrUrl } from '@ai-review/core';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { getSession } from '@/lib/session';
import { loadOnboardingProgress } from '@/lib/onboarding-progress';
import { FinishStep, type PreviewSection } from '@/components/onboarding/FinishStep';

/**
 * GET /onboarding/finish — ONB-05, the last wizard step (Flow A steps 8-12).
 *
 * Everything on the screen is assembled here rather than fetched from the browser: the previews
 * are read-only projections of what the previous four steps saved, and a client fetch would put
 * a spinner on a screen whose whole job is to show the owner what they already have.
 *
 * There is deliberately no redirect for an unfinished tenant. Someone who lands here with a
 * half-configured business is shown what is missing and a link to the step that fixes it —
 * bouncing them to an earlier screen tells them nothing about why they were moved.
 */

export const metadata: Metadata = { title: 'Publish your page' };

/**
 * force-dynamic, not the default cache.
 *
 * The four preceding steps write on Continue, so a cached render would list requirements the
 * owner has just satisfied, and after publishing it would keep showing the draft state. The
 * `router.refresh()` this screen relies on after publishing depends on the same thing.
 */
export const dynamic = 'force-dynamic';

export default async function OnboardingFinishPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const database = db();
  const tenant = await new TenantGuard(database).resolveActive(session);
  if (!tenant.ok) redirect('/login');

  const businessId = tenant.businessId;

  // One await for six independent reads. Sequentially this is six round trips to render a
  // summary of data that is already written.
  const [progress, identityRows, slugRows, linkRows, contextRows, modeRows, qrRows] =
    await Promise.all([
      loadOnboardingProgress(database, businessId),

      database
        .select({
          name: businesses.name,
          description: businesses.description,
          logoAssetId: businesses.logoAssetId,
        })
        .from(businesses)
        .where(eq(businesses.id, businessId))
        .limit(1),

      database
        .select({ slug: businessSlugs.slug })
        .from(businessSlugs)
        .where(and(eq(businessSlugs.businessId, businessId), eq(businessSlugs.isPrimary, true)))
        .limit(1),

      database
        .select({
          id: businessLinks.id,
          linkType: businessLinks.linkType,
          label: businessLinks.label,
          url: businessLinks.url,
          phone: businessLinks.phone,
        })
        .from(businessLinks)
        .where(and(eq(businessLinks.businessId, businessId), eq(businessLinks.isEnabled, true)))
        // D-015: stored order is the owner order, and createdAt breaks ties, so the preview
        // cannot disagree with the public page about which button comes first (AC-021).
        .orderBy(asc(businessLinks.sortOrder), asc(businessLinks.createdAt)),

      database
        .select({ terms: aiBusinessContexts.contextTerms })
        .from(aiBusinessContexts)
        .where(eq(aiBusinessContexts.businessId, businessId))
        .limit(1),

      database
        .select({ name: reviewModes.name })
        .from(reviewModes)
        .where(
          and(
            eq(reviewModes.businessId, businessId),
            eq(reviewModes.isActive, true),
            eq(reviewModes.isArchived, false),
          ),
        )
        .limit(1),

      // The default source publish creates is the oldest row, so ordering by createdAt picks
      // "Main QR" rather than whichever row the planner happened to return first.
      database
        .select({ id: qrCodes.id, code: qrCodes.code, label: qrCodes.sourceLabel })
        .from(qrCodes)
        .where(eq(qrCodes.businessId, businessId))
        .orderBy(asc(qrCodes.createdAt))
        .limit(1),
    ]);

  // TenantGuard already resolved this business, so the row exists. The fallback is here to
  // satisfy the indexed-access check, not because an owner can reach this page without one.
  const identity = identityRows[0] ?? { name: '', description: null, logoAssetId: null };
  const slug = slugRows[0]?.slug ?? null;
  const qr = qrRows[0];

  return (
    <FinishStep
      published={progress.isPublished}
      businessName={identity.name}
      description={identity.description}
      hasLogo={identity.logoAssetId !== null}
      sections={buildPreviewSections(linkRows, progress.hasReviewLink)}
      canonicalUrl={slug ? new URL(`/${slug}`, env().APP_BASE_URL).toString() : null}
      qrCode={
        qr
          ? {
              id: qr.id,
              code: qr.code,
              label: qr.label,
              scanUrl: buildQrUrl(env().APP_BASE_URL, qr.code),
            }
          : null
      }
      reviewModeName={modeRows[0]?.name ?? null}
      contextTerms={asStringArray(contextRows[0]?.terms)}
      missing={derivePublishBlockers(progress)}
    />
  );
}

/**
 * What POST /business/publish would refuse this tenant for, derived before the button is pressed.
 *
 * The keys are the endpoint own vocabulary (`details.missing`), so the screen carries one
 * key-to-step mapping rather than two, and a 409 arriving later renders through the same list.
 *
 * One interpretation worth stating: the endpoint separates `business_details` from
 * `web_address`, while `loadOnboardingProgress` folds the web address into `hasBusinessDetails`.
 * Both are captured on ONB-01, so both resolve to the same screen and the distinction changes
 * nothing the owner can act on. A refusal that names `web_address` is still labelled precisely,
 * because the client keeps a row for that key.
 *
 * `hasContactLinks` and `hasAiContext` are deliberately absent: publish requires neither (ONB-03
 * is skippable and publish seeds the D-014 defaults itself), so listing them here would invent a
 * requirement the API does not have. They appear as optional prompts inside the previews.
 */
function derivePublishBlockers(progress: {
  hasBusinessDetails: boolean;
  hasReviewLink: boolean;
}): string[] {
  const missing: string[] = [];
  if (!progress.hasBusinessDetails) missing.push('business_details');
  if (!progress.hasReviewLink) missing.push('google_review_link');
  return missing;
}

interface LinkRow {
  id: string;
  linkType: string;
  label: string;
  url: string | null;
  phone: string | null;
}

/**
 * The sections the public page will actually render.
 *
 * Mirrors the rule in `app/[slug]/page.tsx` — a section without a resolvable target is absent,
 * not disabled (AC-020) — at the grain a preview needs: presence of a target, rather than the
 * scheme check that renderer performs before emitting an href. That renderer stays
 * authoritative. The rule is repeated here only because previewing a button the public page
 * would drop makes the preview a lie.
 */
function buildPreviewSections(links: LinkRow[], hasReviewDestination: boolean): PreviewSection[] {
  const sections = links
    .filter((link) => hasTarget(link, hasReviewDestination))
    .map((link) => ({
      id: link.id,
      label: link.label,
      isPrimary: link.linkType === 'GOOGLE_REVIEW',
    }));

  // A tenant that skipped ONB-03 has no link rows yet, but publish creates the D-014 defaults
  // with GOOGLE_REVIEW enabled. Without this the preview would show a page with no Review Us
  // button seconds before publish adds one.
  if (hasReviewDestination && !sections.some((section) => section.isPrimary)) {
    sections.unshift({ id: 'default-google-review', label: 'Review Us', isPrimary: true });
  }

  return sections;
}

function hasTarget(link: LinkRow, hasReviewDestination: boolean): boolean {
  // AMENDMENT-003: the GOOGLE_REVIEW row is presentation only and carries no url of its own, so
  // whether it can render depends on review_destinations.
  if (link.linkType === 'GOOGLE_REVIEW') return hasReviewDestination;
  return (link.url?.trim().length ?? 0) > 0 || (link.phone?.trim().length ?? 0) > 0;
}

/** context_terms is jsonb, so its stored shape is a promise rather than a guarantee. */
function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

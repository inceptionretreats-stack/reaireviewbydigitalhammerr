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
import { FinishStep } from '@/components/onboarding/FinishStep';
import { qrDataUri } from '@/lib/qr-image';
import {
  asStringArray,
  buildPreviewSections,
  derivePublishBlockers,
} from '@/components/onboarding/finish-preview';

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

export const metadata: Metadata = {
  // The root layout sets a static title with no `title.template`, so a child title replaces it
  // outright — hence the product name here, matching the four sibling onboarding pages.
  title: 'Publish your page | AI Review',
  description:
    'Publish your business page, get your own web address, and download your first QR code.',
};

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
          // Selected for derivePublishBlockers rather than for display: the shell test publish
          // runs is (name, category), so readiness cannot be judged without both.
          category: businesses.category,
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
  const identity = identityRows[0] ?? {
    name: '',
    category: '',
    description: null,
    logoAssetId: null,
  };
  const slug = slugRows[0]?.slug ?? null;
  const qr = qrRows[0];

  // Rendered here rather than in the client component: the encoder is server-side, and generating
  // it alongside the row means the preview and the downloadable file are the same symbol by
  // construction. Only one code exists at this point, so this is one encode, not a loop.
  const qrScanUrl = qr ? buildQrUrl(env().APP_BASE_URL, qr.code) : null;
  const qrPreviewSrc = qrScanUrl ? await qrDataUri(qrScanUrl) : null;

  // The publish endpoint's own three tests, run against the rows this page has already read, so
  // the list rendered now and a 409 arriving later cannot disagree about what is missing.
  const publishBlockers = derivePublishBlockers({
    name: identity.name,
    category: identity.category,
    hasPrimarySlug: slug !== null,
    hasReviewDestination: progress.hasReviewLink,
  });

  return (
    <FinishStep
      published={progress.status !== 'DRAFT'}
      lifecycle={progress.status}
      businessName={identity.name}
      description={identity.description}
      hasLogo={identity.logoAssetId !== null}
      sections={buildPreviewSections(linkRows, progress.hasReviewLink)}
      canonicalUrl={slug ? new URL(`/${slug}`, env().APP_BASE_URL).toString() : null}
      qrCode={
        qr && qrScanUrl && qrPreviewSrc
          ? {
              id: qr.id,
              code: qr.code,
              label: qr.label,
              scanUrl: qrScanUrl,
              previewSrc: qrPreviewSrc,
            }
          : null
      }
      reviewModeName={modeRows[0]?.name ?? null}
      contextTerms={asStringArray(contextRows[0]?.terms)}
      missing={publishBlockers}
    />
  );
}

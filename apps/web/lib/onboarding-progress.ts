import { and, eq, isNotNull, ne, or } from 'drizzle-orm';
import {
  aiBusinessContexts,
  businessLinks,
  businessSlugs,
  businesses,
  reviewDestinations,
  type Database,
} from '@ai-review/db';
import { SHELL_CATEGORY } from './auth-helpers';
import type { OnboardingProgress } from '@/components/onboarding/steps';

/**
 * Derives onboarding progress from the tenant rather than from a stored cursor.
 *
 * Every ONB screen offers "Save & exit", and an owner may also close the tab, return on another
 * device, or revisit a step out of order. Derived state cannot go stale; a stored "current step"
 * can, and would send someone back to a screen they had already completed.
 */
export async function loadOnboardingProgress(
  db: Database,
  businessId: string,
): Promise<OnboardingProgress> {
  const [business] = await db
    .select({
      name: businesses.name,
      category: businesses.category,
      city: businesses.city,
      status: businesses.status,
    })
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);

  const [slug] = await db
    .select({ slug: businessSlugs.slug })
    .from(businessSlugs)
    .where(and(eq(businessSlugs.businessId, businessId), eq(businessSlugs.isPrimary, true)))
    .limit(1);

  const [destination] = await db
    .select({ id: reviewDestinations.id })
    .from(reviewDestinations)
    .where(
      and(eq(reviewDestinations.businessId, businessId), eq(reviewDestinations.isPrimary, true)),
    )
    .limit(1);

  // A contact link counts only once it has somewhere to point. ONB-03 lets every optional field
  // be skipped, so the GOOGLE_REVIEW row — which is created with no target of its own — must not
  // be what makes this step look finished.
  const [link] = await db
    .select({ id: businessLinks.id })
    .from(businessLinks)
    .where(
      and(
        eq(businessLinks.businessId, businessId),
        ne(businessLinks.linkType, 'GOOGLE_REVIEW'),
        or(isNotNull(businessLinks.url), isNotNull(businessLinks.phone)),
      ),
    )
    .limit(1);

  const [context] = await db
    .select({ businessId: aiBusinessContexts.businessId })
    .from(aiBusinessContexts)
    .where(eq(aiBusinessContexts.businessId, businessId))
    .limit(1);

  return {
    // Carried through rather than flattened to a boolean. An earlier version reported
    // isPublished as (status === 'ACTIVE'), which folded SUSPENDED and CLOSED in with
    // never-published — so a suspended tenant was offered a Publish button that the publish
    // route refuses outright.
    status: business?.status ?? 'DRAFT',
    // The signup shell carries a placeholder category, so its presence means ONB-01 is untouched.
    hasBusinessDetails:
      business !== undefined &&
      business.category !== SHELL_CATEGORY &&
      (business.city?.trim().length ?? 0) > 0 &&
      slug !== undefined,
    hasReviewLink: destination !== undefined,
    hasContactLinks: link !== undefined,
    hasAiContext: context !== undefined,
  };
}

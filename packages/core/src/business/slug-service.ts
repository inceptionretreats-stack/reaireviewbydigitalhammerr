import { and, eq } from 'drizzle-orm';
import { businessSlugs, type Database } from '@ai-review/db';
import { validateSlug, type SlugRejection } from './slug';

/**
 * Slug reservation over the single namespace introduced by AMENDMENT-005.
 *
 * The original schema split live slugs from retired aliases across two tables with independent
 * unique constraints, which do not compose into one namespace: a new business could claim a slug
 * still serving as another business's redirect. Both now live in business_slugs, whose primary
 * key IS the namespace, and this service is the only thing that writes to it.
 *
 * Flow I is what makes this more than an insert: changing a slug must keep the old one working
 * as a redirect for a retention period, so a claim is really "promote this, demote that, both or
 * neither".
 */

/** Flow I: "recommended 180 days". Old links and printed material keep working for that long. */
export const ALIAS_RETENTION_DAYS = 180;

export type SlugClaimFailure = { reason: 'INVALID'; detail: SlugRejection } | { reason: 'TAKEN' };

export type SlugClaimResult =
  | { ok: true; slug: string; previousSlug: string | null }
  | { ok: false; failure: SlugClaimFailure };

export class SlugService {
  constructor(private readonly db: Database) {}

  /**
   * Whether a slug can be claimed by this business.
   *
   * Scoped to the asking business on purpose: a business reclaiming a slug it still holds as an
   * alias must be told yes, while any other business must be told no. A global "does this row
   * exist" check would wrongly refuse the first case, which is the natural outcome of an owner
   * changing their mind and changing it back.
   */
  async isAvailableFor(businessId: string, candidate: string): Promise<boolean> {
    const validation = validateSlug(candidate);
    if (!validation.ok) return false;

    const [existing] = await this.db
      .select({ businessId: businessSlugs.businessId })
      .from(businessSlugs)
      .where(eq(businessSlugs.slug, validation.slug))
      .limit(1);

    return !existing || existing.businessId === businessId;
  }

  /**
   * Claims a slug as this business's primary, demoting the previous primary to a redirect.
   *
   * One transaction, because the intermediate state — a business with no primary slug, or two —
   * would make the public route either 404 or ambiguous. The partial unique index
   * uq_one_primary_slug_per_business enforces the "two" half at the database level, which is why
   * the demote must happen before the promote rather than after.
   */
  async claim(businessId: string, candidate: string): Promise<SlugClaimResult> {
    const validation = validateSlug(candidate);
    if (!validation.ok) {
      return { ok: false, failure: { reason: 'INVALID', detail: validation.reason } };
    }
    const slug = validation.slug;

    try {
      return await this.db.transaction(async (tx) => {
        const [owner] = await tx
          .select({ businessId: businessSlugs.businessId, isPrimary: businessSlugs.isPrimary })
          .from(businessSlugs)
          .where(eq(businessSlugs.slug, slug))
          .limit(1);

        if (owner && owner.businessId !== businessId) {
          return { ok: false, failure: { reason: 'TAKEN' } } as SlugClaimResult;
        }

        // Already this business's primary: nothing to do, and re-running the demote/promote
        // would pointlessly create an alias pointing at the slug the business still uses.
        if (owner?.isPrimary) {
          return { ok: true, slug, previousSlug: null } as SlugClaimResult;
        }

        const [current] = await tx
          .select({ slug: businessSlugs.slug })
          .from(businessSlugs)
          .where(and(eq(businessSlugs.businessId, businessId), eq(businessSlugs.isPrimary, true)))
          .limit(1);

        if (current) {
          // Demoted first, so the partial unique index never sees two primaries for this
          // business. ck_alias_has_expiry requires the retention date on a non-primary row.
          await tx
            .update(businessSlugs)
            .set({ isPrimary: false, redirectUntil: retentionDate() })
            .where(eq(businessSlugs.slug, current.slug));
        }

        if (owner) {
          // Reclaiming one of this business's own aliases. Promote it and clear the expiry,
          // which ck_alias_has_expiry only requires while it is an alias.
          await tx
            .update(businessSlugs)
            .set({ isPrimary: true, redirectUntil: null })
            .where(eq(businessSlugs.slug, slug));
        } else {
          await tx.insert(businessSlugs).values({ slug, businessId, isPrimary: true });
        }

        return { ok: true, slug, previousSlug: current?.slug ?? null } as SlugClaimResult;
      });
    } catch (error) {
      // Two businesses racing for the same free slug: one wins the primary key, the other lands
      // here. Reported as taken rather than as a server error, because that is what happened.
      if (isUniqueViolation(error)) {
        return { ok: false, failure: { reason: 'TAKEN' } };
      }
      throw error;
    }
  }

  /** The business's current public slug, or null while onboarding has not claimed one. */
  async primarySlugFor(businessId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ slug: businessSlugs.slug })
      .from(businessSlugs)
      .where(and(eq(businessSlugs.businessId, businessId), eq(businessSlugs.isPrimary, true)))
      .limit(1);

    return row?.slug ?? null;
  }
}

function retentionDate(): Date {
  return new Date(Date.now() + ALIAS_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

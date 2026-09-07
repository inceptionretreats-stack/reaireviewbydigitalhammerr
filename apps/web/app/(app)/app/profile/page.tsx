import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { assets, businessLinks, businesses, reviewDestinations } from '@ai-review/db';
import { SlugService, TenantGuard } from '@ai-review/core';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { getSession } from '@/lib/session';
import { describeBusinessStatus } from '@/components/dashboard/presentation';
import { ProfileEditor, type StoredSection } from '@/components/dashboard/profile/ProfileEditor';
import { isSectionType } from '@/components/dashboard/profile/sections';

/**
 * PROFILE-01 — `/app/profile`, the public trust page editor.
 *
 * Everything the editor needs is read here, on the server, in one pass. The alternative — a client
 * component that fetches `/business`, `/business/links` and `/business/review-destination` on mount —
 * would put three authenticated round trips and a spinner in front of a form whose data the server
 * already has, and would leave the name and description briefly blank, which on this screen reads as
 * "my details are gone".
 *
 * No business id is taken from the request. `TenantGuard.resolveActive` derives it from the session,
 * which is what RBAC rule 2 and AC-003 require, and it is the same division the dashboard's
 * `DashboardOverview` draws: the layout guards the session, each page resolves the tenant it needs.
 *
 * This page awaits its data rather than deferring it behind Suspense. PROFILE-01 lists `editing`,
 * `saved` and `preview` as its states and no loading state, and a form skeleton would be a fourth
 * state the spec does not ask for.
 */

export const metadata: Metadata = {
  title: 'Business profile | AI Review',
  description: 'Edit the public page customers land on, and the order of its buttons.',
};

export default async function Page() {
  const session = await getSession();

  // The layout has already redirected an anonymous caller. Repeated because this page reads tenant
  // data and must not depend on a parent's guard for that; it also narrows the type.
  if (!session) redirect('/login');

  const database = db();
  const tenant = await new TenantGuard(database).resolveActive(session);
  // A signed-in user with no business is a broken invariant, not a state this screen can render.
  // The dashboard already explains it, so it is the one place that says so.
  if (!tenant.ok) redirect('/app');

  // A soft-deleted asset must not leave a broken image on the editor any more than on the public
  // page, so the joins exclude it rather than the render.
  const logo = alias(assets, 'logo_asset');
  const cover = alias(assets, 'cover_asset');

  const [identityRows, links, destinations, slug] = await Promise.all([
    database
      .select({
        name: businesses.name,
        description: businesses.description,
        category: businesses.category,
        city: businesses.city,
        state: businesses.state,
        timezone: businesses.timezone,
        status: businesses.status,
        brandAccent: businesses.brandAccent,
        logoStorageKey: logo.storageKey,
        coverStorageKey: cover.storageKey,
      })
      .from(businesses)
      .leftJoin(logo, and(eq(logo.id, businesses.logoAssetId), isNull(logo.deletedAt)))
      .leftJoin(cover, and(eq(cover.id, businesses.coverAssetId), isNull(cover.deletedAt)))
      .where(eq(businesses.id, tenant.businessId))
      .limit(1),

    database
      .select({
        id: businessLinks.id,
        type: businessLinks.linkType,
        label: businessLinks.label,
        url: businessLinks.url,
        phone: businessLinks.phone,
        enabled: businessLinks.isEnabled,
      })
      .from(businessLinks)
      .where(eq(businessLinks.businessId, tenant.businessId))
      // The owner's order (D-015, AC-021). createdAt breaks ties for the same reason the public page
      // breaks them that way: two sections sharing a sort_order must not swap places between renders.
      .orderBy(asc(businessLinks.sortOrder), asc(businessLinks.createdAt)),

    // Read on exactly the terms `lib/public-business.ts` reads it on — primary *and* enabled. This
    // value decides whether the preview draws a Review Us button and whether the row reports "Shows
    // on your page", so a weaker filter here would promise a button no visitor gets (AC-020).
    database
      .select({ url: reviewDestinations.url })
      .from(reviewDestinations)
      .where(
        and(
          eq(reviewDestinations.businessId, tenant.businessId),
          eq(reviewDestinations.isPrimary, true),
          eq(reviewDestinations.isEnabled, true),
        ),
      )
      .limit(1),

    new SlugService(database).primarySlugFor(tenant.businessId),
  ]);

  const identity = identityRows[0];
  if (!identity) redirect('/app');

  const status = describeBusinessStatus(identity.status);

  const sections: StoredSection[] = [];
  for (const link of links) {
    // `link_type` is a Postgres enum, so an unknown value means the enum has gained a member this
    // screen has not been told about. Dropped rather than rendered as an unnamed row — the row itself
    // is untouched, so nothing is lost by not offering to edit it. A loop rather than filter+map
    // because the guard narrows `link.type` here and cannot narrow through `filter`.
    if (!isSectionType(link.type)) continue;

    sections.push({
      id: link.id,
      type: link.type,
      label: link.label,
      url: link.url,
      phone: link.phone,
      enabled: link.enabled,
    });
  }

  return (
    <ProfileEditor
      name={identity.name}
      description={identity.description ?? ''}
      passthrough={{
        // Round tripped unchanged: businessIdentityRequest requires all of these, and PROFILE-01
        // edits only the name and the description. City and state are nullable columns that the
        // contract types as strings, so an unset one travels as ''.
        category: identity.category,
        city: identity.city ?? '',
        state: identity.state ?? '',
        timezone: identity.timezone,
        slug,
      }}
      sections={sections}
      reviewUrl={destinations[0]?.url ?? null}
      publicUrl={slug === null ? null : new URL(`/${slug}`, env().APP_BASE_URL).toString()}
      isLive={status.isPubliclyLive}
      // Flow J: a suspended or closed tenant sees why editing is paused rather than a form whose
      // Save is refused by the endpoints. This is the explanation, not the enforcement — all three
      // endpoints this screen writes to refuse the same two statuses themselves
      // (PATCH/DELETE /business/links/{id}, POST /business/links/reorder, PATCH /business).
      frozenNote={
        identity.status === 'SUSPENDED' || identity.status === 'CLOSED' ? status.note : null
      }
      logoUrl={assetUrl(identity.logoStorageKey)}
      coverUrl={assetUrl(identity.coverStorageKey)}
      brandAccent={identity.brandAccent}
    />
  );
}

/**
 * Public URL for a stored asset.
 *
 * Same construction as the public profile page: the asset host is `S3_PUBLIC_BASE_URL`, which is
 * optional, so a missing base means there is no URL to show rather than a broken image.
 */
function assetUrl(storageKey: string | null): string | null {
  const base = env().S3_PUBLIC_BASE_URL;
  if (!base || !storageKey) return null;
  return `${base.replace(/\/+$/, '')}/${storageKey.replace(/^\/+/, '')}`;
}

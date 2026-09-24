import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { businesses } from '@ai-review/db';
import {
  ALIAS_RETENTION_DAYS,
  SLUG_MAX_LENGTH,
  SLUG_MIN_LENGTH,
  SlugService,
  TenantGuard,
  normalizeSlug,
} from '@ai-review/core';
import { BusinessStep } from '@/components/onboarding/BusinessStep';
import { SHELL_CATEGORY, isShell } from '@/lib/auth/helpers';
import { db } from '@/lib/infra/db';
import { env } from '@/lib/infra/env';
import { getSession } from '@/lib/auth/session';

export const metadata: Metadata = {
  title: 'Your business | Ai Review',
  description: 'Your name, category, city and the web address customers will see.',
};

/**
 * ONB-01 — /onboarding/business.
 *
 * A Server Component that reads the current identity and hands it to the step as initial values.
 * Deliberately not a fetch on mount: an owner reaching this step again — after "Save & exit",
 * from another device, or via the dashboard's resume link — would otherwise watch six populated
 * fields appear out of an empty form, and could type into them during the gap.
 *
 * The query mirrors GET /api/v1/business rather than calling it. Invoking a route handler from a
 * Server Component costs an extra HTTP hop and would have to forward the request's own cookies to
 * authenticate; the tenant is already resolved here.
 */
export default async function Page() {
  const session = await getSession();
  // The layout already refuses an anonymous visitor. Repeated because the tenant lookup needs the
  // session anyway, and a page that reads it should not depend on a parent having run first.
  if (!session) redirect('/login');

  const database = db();
  const tenant = await new TenantGuard(database).resolveActive(session);
  if (!tenant.ok) redirect('/login');

  const [business] = await database
    .select({
      name: businesses.name,
      category: businesses.category,
      description: businesses.description,
      city: businesses.city,
      state: businesses.state,
      timezone: businesses.timezone,
    })
    .from(businesses)
    .where(eq(businesses.id, tenant.businessId))
    .limit(1);

  // Unreachable while the tenant resolves — resolveActive selected this very row — but a 404 is a
  // better answer than a redirect loop if that invariant is ever broken.
  if (!business) notFound();

  const claimedSlug = await new SlugService(database).primarySlugFor(tenant.businessId);

  /*
   * Signup writes placeholders into name and category, because both columns are NOT NULL and
   * AUTH-01 collects neither (lib/auth/helpers.ts). The placeholder name is the *person's* full
   * name, which looks enough like a business name that offering it back as one invites an owner to
   * accept it — and their public page ends up titled after them. Both placeholders are therefore
   * presented as empty rather than as data.
   */
  const name = isShell(business.name, business.category) ? '' : business.name;
  const category = business.category === SHELL_CATEGORY ? '' : business.category;

  return (
    <BusinessStep
      initial={{
        name,
        category,
        description: business.description ?? '',
        city: business.city ?? '',
        state: business.state ?? '',
        // Not a field on this screen. Carried through the form because businessIdentityRequest
        // defaults timezone to Asia/Kolkata, so omitting it from the PATCH would quietly reset a
        // tenant that had set its own — and with it every analytics day boundary (AMENDMENT-004,
        // AC-026).
        timezone: business.timezone,
        // normalizeSlug runs here, on the server, and its result is the field's first value: the
        // seed is on screen in the first paint rather than arriving after hydration.
        slug: claimedSlug ?? normalizeSlug(name),
      }}
      slugClaimed={claimedSlug !== null}
      rules={{
        slugMinLength: SLUG_MIN_LENGTH,
        slugMaxLength: SLUG_MAX_LENGTH,
        aliasRetentionDays: ALIAS_RETENTION_DAYS,
      }}
      publicUrlPrefix={publicUrlPrefix()}
    />
  );
}

/**
 * The host customers will see, e.g. `review.digitalhammerr.com/`.
 *
 * Derived from APP_BASE_URL because the public profile is served from the app origin at /{slug}
 * (app/(customer)/[slug]/page.tsx). A hardcoded production host would show the wrong address in every other
 * environment, and this string is what an owner reads before committing to their slug.
 */
function publicUrlPrefix(): string {
  return `${new URL(env().APP_BASE_URL).host}/`;
}

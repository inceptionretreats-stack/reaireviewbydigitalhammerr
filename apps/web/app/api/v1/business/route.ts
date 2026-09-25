import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { businesses } from '@ai-review/db';
import { SlugService } from '@ai-review/core';
import { businessIdentityRequest } from '@ai-review/contracts';
import { db } from '@/lib/infra/db';
import { apiError } from '@/lib/http/api-error';
import { readJsonObject } from '@/lib/http/request-body';
import { requireTenant, type AuthenticatedContext } from '@/lib/tenant/require-tenant';
import { recordActivity } from '@/lib/activity/recorder';

/**
 * GET/PATCH /api/v1/business — ONB-01 and the identity half of PROFILE-01.
 *
 * The tenant is never taken from the request: requireTenant resolves it from the session, so
 * there is no business id in the URL or body for a caller to tamper with (RBAC rule 2, AC-003).
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireTenant(request);
  if (!auth.ok) return auth.response;

  const database = db();
  const [business] = await database
    .select({
      name: businesses.name,
      category: businesses.category,
      description: businesses.description,
      city: businesses.city,
      state: businesses.state,
      timezone: businesses.timezone,
      status: businesses.status,
      publishedAt: businesses.publishedAt,
    })
    .from(businesses)
    .where(eq(businesses.id, auth.context.businessId))
    .limit(1);

  if (!business) return apiError('RESOURCE_NOT_FOUND', 'We could not find your business.');

  const slug = await new SlugService(database).primarySlugFor(auth.context.businessId);

  return NextResponse.json({ ...business, slug });
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const auth = await requireTenant(request);
  if (!auth.ok) return auth.response;

  // Flow J, before anything is parsed or claimed. PROFILE-01 disables its Save for a suspended or
  // closed tenant, but a disabled button is not a rule: without this a suspended owner could still
  // rename the business and reclaim a slug with one request, which is exactly the cosmetic
  // suspension `requireActiveTenant` warns about.
  const frozen = refuseFrozenTenant(auth.context);
  if (frozen) return frozen;

  const rawResult = await readJsonObject(request);
  if (!rawResult.ok) return rawResult.response;
  const raw = rawResult.body;

  const parsed = businessIdentityRequest.safeParse(raw);
  if (!parsed.success) {
    return apiError('VALIDATION_FAILED', 'Please check the details you entered.', {
      details: {
        fields: [...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? 'body')))],
      },
    });
  }

  const { slug, ...identity } = parsed.data;
  const database = db();
  const slugs = new SlugService(database);
  const { businessId } = auth.context;

  // The slug is claimed first. If it is taken, the identity update must not have happened —
  // otherwise the owner sees "that address is taken" while their business name has silently
  // changed, which is the kind of partial write AC-001 objects to elsewhere.
  const claim = await slugs.claim(businessId, slug);
  if (!claim.ok) {
    return claim.failure.reason === 'TAKEN'
      ? apiError('SLUG_UNAVAILABLE', 'That web address is already taken. Please choose another.', {
          details: { fields: ['slug'] },
        })
      : apiError('VALIDATION_FAILED', slugMessage(claim.failure.detail), {
          details: { fields: ['slug'] },
        });
  }

  await database
    .update(businesses)
    .set({
      name: identity.name,
      category: identity.category,
      description: identity.description ?? null,
      city: identity.city,
      state: identity.state,
      timezone: identity.timezone,
      updatedAt: new Date(),
      // Bumped so the cached public configuration is invalidated. AC-017 relies on a change
      // here being visible immediately, and a cache keyed on business_id alone would not be.
      configVersion: bumpConfigVersion(),
    })
    .where(eq(businesses.id, businessId));

  recordActivity(
    request,
    { session: auth.context.session, businessId },
    {
      action: 'business.update',
      targetType: 'business',
      targetId: businessId,
      metadata: {
        slug: claim.slug,
        slug_changed: claim.previousSlug !== null && claim.previousSlug !== claim.slug,
      },
    },
  );
  return NextResponse.json({
    slug: claim.slug,
    previous_slug: claim.previousSlug,
    // Flow I: the old address keeps working as a redirect, and the owner should be told so
    // rather than discovering it.
    previous_slug_redirects: claim.previousSlug !== null,
  });
}

/**
 * Flow J: a suspended or closed business must not edit its own identity, or a suspension is
 * cosmetic.
 *
 * `requireActiveTenant` is deliberately not used, and the two statuses are named instead: this same
 * handler is ONB-01's, which legitimately runs against a DRAFT tenant that has not published yet.
 * The wording and the code match `business/links/{id}` and `business/links/reorder` so the three
 * endpoints PROFILE-01 writes to answer a frozen tenant identically.
 */
function refuseFrozenTenant(context: AuthenticatedContext): NextResponse | null {
  if (context.status === 'SUSPENDED' || context.status === 'CLOSED') {
    return apiError('BUSINESS_NOT_ACTIVE', 'This business is not active.');
  }
  return null;
}

/**
 * config_version is a monotonically increasing marker, not a count of edits. Using the clock
 * keeps it increasing across replicas without a read-modify-write on the row.
 */
function bumpConfigVersion(): number {
  return Date.now();
}

function slugMessage(reason: string): string {
  switch (reason) {
    case 'TOO_SHORT':
      return 'Use at least 3 characters.';
    case 'TOO_LONG':
      return 'That web address is too long.';
    case 'RESERVED':
      return 'That web address is reserved. Please choose another.';
    case 'NUMERIC_ONLY':
      return 'Include at least one letter.';
    case 'INVALID_CHARACTERS':
      return 'Use only lowercase letters, numbers and hyphens.';
    case 'CONSECUTIVE_HYPHENS':
      return 'Avoid two hyphens in a row.';
    default:
      return 'Do not start or end with a hyphen.';
  }
}

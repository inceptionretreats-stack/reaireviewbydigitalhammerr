import { NextResponse, type NextRequest } from 'next/server';
import { SlugService, normalizeSlug, suggestSlugs, validateSlug } from '@ai-review/core';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/require-tenant';

/**
 * GET /api/v1/business/slug-available?slug=... — drives the `slug available` / `slug unavailable`
 * states in ONB-01.
 *
 * Authenticated on purpose. An open endpoint answering "does this slug exist" would enumerate
 * every business on the platform, and the slug is the one identifier that is both guessable and
 * public. Requiring a session does not stop a determined crawler — the public page answers the
 * same question — but it keeps this from being the convenient way to do it.
 *
 * Availability is asked on behalf of the caller's own business, so a business reclaiming a slug
 * it still holds as a redirect is correctly told it is available (see SlugService.isAvailableFor).
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireTenant(request);
  if (!auth.ok) return auth.response;

  const candidate = new URL(request.url).searchParams.get('slug') ?? '';
  const validation = validateSlug(candidate);

  if (!validation.ok) {
    return NextResponse.json({
      slug: normalizeSlug(candidate),
      available: false,
      reason: validation.reason,
      // Suggestions are offered even for an invalid candidate, because the commonest reason to
      // be invalid is punctuation or spacing that normalizeSlug simply fixes.
      suggestions: await firstAvailable(auth.context.businessId, candidate),
    });
  }

  const service = new SlugService(db());
  const available = await service.isAvailableFor(auth.context.businessId, validation.slug);

  return NextResponse.json({
    slug: validation.slug,
    available,
    reason: available ? null : 'TAKEN',
    suggestions: available ? [] : await firstAvailable(auth.context.businessId, candidate),
  });
}

/**
 * Up to three claimable alternatives.
 *
 * Checked rather than merely generated: offering a suggestion that is itself taken makes the
 * feature worse than offering none, because the owner has to discover that by trying it.
 */
async function firstAvailable(businessId: string, base: string): Promise<string[]> {
  const service = new SlugService(db());
  const found: string[] = [];

  for (const candidate of suggestSlugs(base)) {
    if (found.length === 3) break;
    if (await service.isAvailableFor(businessId, candidate)) found.push(candidate);
  }

  return found;
}

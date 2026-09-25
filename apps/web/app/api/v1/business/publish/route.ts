import { NextResponse, type NextRequest } from 'next/server';
import { and, eq } from 'drizzle-orm';
import {
  businessLinks,
  businessSlugs,
  businesses,
  qrCodes,
  reviewDestinations,
} from '@ai-review/db';
import { buildQrUrl, generateQrCode } from '@ai-review/core';
import { db } from '@/lib/infra/db';
import { env } from '@/lib/infra/env';
import { apiError } from '@/lib/http/api-error';
import { requireTenant } from '@/lib/tenant/require-tenant';
import { isShell } from '@/lib/tenant/tenant-shell';
import { recordActivity } from '@/lib/activity/recorder';

/** Flow A step 10 names it. It appears in analytics as the source label, so it must read well. */
const DEFAULT_QR_LABEL = 'Main QR';

/**
 * POST /api/v1/business/publish — ONB-05.
 *
 * Publishing is the moment a tenant becomes reachable by the public, so this is where readiness is
 * enforced rather than trusted. A DRAFT business can be half-configured by design — the wizard
 * saves as it goes — and the checks below are what stop that state from going live.
 *
 * ONB-05-01 requires publish to create the default QR source, and ONB-05-02 requires the canonical
 * route to work immediately. Both are satisfied in one transaction with the status change: a QR
 * that resolved to a business still marked DRAFT would render the unavailable page, and a business
 * marked ACTIVE with no QR would leave Flow A step 11 with nothing to download.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireTenant(request);
  if (!auth.ok) return auth.response;

  const database = db();
  const { businessId } = auth.context;

  const [business] = await database
    .select({
      name: businesses.name,
      category: businesses.category,
      status: businesses.status,
      publishedAt: businesses.publishedAt,
    })
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);

  if (!business) return apiError('RESOURCE_NOT_FOUND', 'We could not find your business.');

  // A suspended or closed tenant must not publish its way back to live (Flow J). Only DRAFT and
  // an already-ACTIVE republish are permitted.
  if (business.status === 'SUSPENDED' || business.status === 'CLOSED') {
    return apiError('BUSINESS_NOT_ACTIVE', 'This business cannot be published.');
  }

  const missing: string[] = [];

  if (isShell(business.name, business.category)) missing.push('business_details');

  const [slug] = await database
    .select({ slug: businessSlugs.slug })
    .from(businessSlugs)
    .where(and(eq(businessSlugs.businessId, businessId), eq(businessSlugs.isPrimary, true)))
    .limit(1);

  if (!slug) missing.push('web_address');

  const [destination] = await database
    .select({ url: reviewDestinations.url })
    .from(reviewDestinations)
    .where(
      and(eq(reviewDestinations.businessId, businessId), eq(reviewDestinations.isPrimary, true)),
    )
    .limit(1);

  // The one genuinely non-negotiable prerequisite. Without it the whole customer journey ends at
  // a Copy button with nowhere to go, and AC-036 has no direct link to fall back to.
  if (!destination) missing.push('google_review_link');

  if (missing.length > 0) {
    return apiError(
      'BUSINESS_NOT_ACTIVE',
      'A few things are still needed before you can publish.',
      {
        details: { missing },
      },
    );
  }

  const publishedSlug = slug!.slug;

  const qrCode = await database.transaction(async (tx) => {
    await tx
      .update(businesses)
      .set({
        status: 'ACTIVE',
        // Preserved on a republish: this is the date the business first went live, and analytics
        // and support both read it as such.
        publishedAt: business.publishedAt ?? new Date(),
        configVersion: Date.now(),
        updatedAt: new Date(),
      })
      .where(eq(businesses.id, businessId));

    // The default sections are created here as a safety net for a tenant that skipped ONB-03.
    // D-014 lists five defaults, and PROFILE-01-01 expects them to exist; only GOOGLE_REVIEW is
    // enabled, because the others have no target yet (ck_enabled_link_has_target).
    const existingLinks = await tx
      .select({ id: businessLinks.id })
      .from(businessLinks)
      .where(eq(businessLinks.businessId, businessId))
      .limit(1);

    if (existingLinks.length === 0) {
      await tx.insert(businessLinks).values({
        businessId,
        linkType: 'GOOGLE_REVIEW',
        label: 'Review Us',
        isEnabled: true,
        sortOrder: 0,
      });
    }

    const existingQr = await tx
      .select({ code: qrCodes.code })
      .from(qrCodes)
      .where(eq(qrCodes.businessId, businessId))
      .limit(1);

    if (existingQr.length > 0) return existingQr[0]!.code;

    return reserveQrCode(tx, businessId);
  });

  recordActivity(
    request,
    { session: auth.context.session, businessId },
    {
      action: 'business.publish',
      targetType: 'business',
      targetId: businessId,
      metadata: { slug: publishedSlug },
    },
  );
  return NextResponse.json({
    status: 'ACTIVE',
    slug: publishedSlug,
    public_url: new URL(`/${publishedSlug}`, env().APP_BASE_URL).toString(),
    qr_code: qrCode,
    qr_url: buildQrUrl(env().APP_BASE_URL, qrCode),
  });
}

/**
 * Inserts a QR with a fresh opaque code, retrying on collision.
 *
 * The code space is about 8e14, so a collision is vanishingly unlikely — but the column is UNIQUE
 * and the consequence of one would be a printed standee resolving to another business's page, so
 * "vanishingly unlikely" is not the same as handled.
 */
async function reserveQrCode(
  tx: Parameters<Parameters<ReturnType<typeof db>['transaction']>[0]>[0],
  businessId: string,
): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateQrCode();
    try {
      await tx.insert(qrCodes).values({
        businessId,
        code,
        sourceLabel: DEFAULT_QR_LABEL,
        status: 'ACTIVE',
      });
      return code;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }
  throw new Error('could not reserve a unique QR code after 5 attempts');
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

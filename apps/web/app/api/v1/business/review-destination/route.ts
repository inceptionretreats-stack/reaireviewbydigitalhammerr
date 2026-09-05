import { NextResponse, type NextRequest } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { businesses, reviewDestinations } from '@ai-review/db';
import { describeReviewUrlRejection, validateGoogleReviewUrl } from '@ai-review/core';
import { db } from '@/lib/db';
import { apiError } from '@/lib/api-error';
import { requireTenant } from '@/lib/require-tenant';

/**
 * GET/PUT /api/v1/business/review-destination — ONB-02, and the edit path AC-017 requires.
 *
 * OPEN-03 records that the delivered contract offers POST /business/review-destinations but no
 * way to edit one, while AC-017 requires that changing the Google URL immediately changes the
 * destination for every existing dynamic QR. An idempotent PUT on the single primary destination
 * is the smaller surface: V1 has exactly one primary per business (uq_one_primary_review_
 * destination), so there is no id for the caller to supply and nothing to enumerate.
 *
 * This row is the single source of truth for the URL (AMENDMENT-003). The GOOGLE_REVIEW row in
 * business_links controls only whether and where the button renders, and carries no url of its
 * own — enforced by ck_google_review_has_no_url.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireTenant(request);
  if (!auth.ok) return auth.response;

  const [destination] = await db()
    .select({ url: reviewDestinations.url, label: reviewDestinations.label })
    .from(reviewDestinations)
    .where(
      and(
        eq(reviewDestinations.businessId, auth.context.businessId),
        eq(reviewDestinations.isPrimary, true),
      ),
    )
    .limit(1);

  return NextResponse.json({
    url: destination?.url ?? null,
    label: destination?.label ?? 'Google',
  });
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  const auth = await requireTenant(request);
  if (!auth.ok) return auth.response;

  let raw: unknown;
  try {
    raw = (await request.json()) as unknown;
  } catch {
    return apiError('VALIDATION_FAILED', 'Malformed request body.');
  }

  const url = typeof raw === 'object' && raw !== null && 'url' in raw ? String(raw.url) : '';

  // Validated in core rather than by a Zod url() check: ONB-02-02 restricts this to Google hosts,
  // and this field is where every customer is sent after copying a draft. A merchant typo here
  // silently routes real traffic nowhere, which is worse than a rejected form.
  const validation = validateGoogleReviewUrl(url);
  if (!validation.ok) {
    return apiError('REVIEW_DESTINATION_INVALID', describeReviewUrlRejection(validation.reason), {
      details: { fields: ['url'] },
    });
  }

  const database = db();
  const { businessId } = auth.context;

  await database.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: reviewDestinations.id })
      .from(reviewDestinations)
      .where(
        and(eq(reviewDestinations.businessId, businessId), eq(reviewDestinations.isPrimary, true)),
      )
      .limit(1);

    if (existing) {
      await tx
        .update(reviewDestinations)
        .set({ url: validation.url, updatedAt: new Date() })
        .where(eq(reviewDestinations.id, existing.id));
    } else {
      await tx.insert(reviewDestinations).values({
        businessId,
        platform: 'GOOGLE',
        label: 'Google',
        url: validation.url,
        isPrimary: true,
        isEnabled: true,
      });
    }

    // AC-017: every dynamic QR reads this on each scan, so the destination has already changed.
    // The bump exists to invalidate the cached public configuration, which is the only thing
    // that could still serve the old URL.
    await tx
      .update(businesses)
      .set({ configVersion: Date.now(), updatedAt: new Date() })
      .where(eq(businesses.id, businessId));
  });

  return NextResponse.json({ url: validation.url, host: validation.host });
}

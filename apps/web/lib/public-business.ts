import { and, eq } from 'drizzle-orm';
import {
  assets,
  businessSlugs,
  businesses,
  qrCodes,
  reviewDestinations,
  type Database,
} from '@ai-review/db';

/**
 * Resolves a public visitor to a tenant, by QR code or by slug.
 *
 * RBAC rule 3 and rule 6 both apply: a QR code is an opaque locator and never an authorization
 * token, and hostname or slug resolution may only ever return *public* tenant configuration.
 * Everything selected below is content the business has chosen to publish.
 */

export interface PublicBusinessConfig {
  businessId: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  /** Resolved live from review_destinations — the single source of truth (AMENDMENT-003). */
  reviewUrl: string | null;
  reviewPlatformLabel: string;
  qrCodeId: string | null;
  qrSourceLabel: string | null;
}

export type PublicResolution =
  | { ok: true; config: PublicBusinessConfig }
  | {
      ok: false;
      reason: 'QR_NOT_FOUND' | 'QR_DISABLED' | 'RESOURCE_NOT_FOUND' | 'BUSINESS_NOT_ACTIVE';
    }
  | { ok: true; redirectTo: string };

/**
 * QR-01-01 and AC-017 together: the code is immutable, but everything it resolves to is read
 * fresh on each scan. Changing the Google URL therefore changes the destination for every
 * printed standee immediately, with no reprint.
 */
export async function resolveByQrCode(db: Database, code: string): Promise<PublicResolution> {
  const [qr] = await db
    .select({
      qrCodeId: qrCodes.id,
      qrStatus: qrCodes.status,
      sourceLabel: qrCodes.sourceLabel,
      businessId: qrCodes.businessId,
    })
    .from(qrCodes)
    .where(eq(qrCodes.code, code))
    .limit(1);

  if (!qr) return { ok: false, reason: 'QR_NOT_FOUND' };

  // QR-01-02: a disabled QR returns a controlled state, never a bare 404 — the standee is
  // still on a counter somewhere and a customer is standing in front of it.
  if (qr.qrStatus === 'DISABLED') return { ok: false, reason: 'QR_DISABLED' };

  const config = await loadPublicConfig(db, qr.businessId);
  if (!config) return { ok: false, reason: 'BUSINESS_NOT_ACTIVE' };

  return {
    ok: true,
    config: { ...config, qrCodeId: qr.qrCodeId, qrSourceLabel: qr.sourceLabel },
  };
}

/**
 * Slug resolution, including retired aliases.
 *
 * One indexed lookup answers both "which business" and "is this a redirect", because live and
 * retired slugs share a namespace (AMENDMENT-005). Flow I keeps aliases working for a
 * retention window so printed material and links survive a rename.
 */
export async function resolveBySlug(db: Database, slug: string): Promise<PublicResolution> {
  const [row] = await db
    .select({
      businessId: businessSlugs.businessId,
      isPrimary: businessSlugs.isPrimary,
      redirectUntil: businessSlugs.redirectUntil,
    })
    .from(businessSlugs)
    .where(eq(businessSlugs.slug, slug))
    .limit(1);

  if (!row) return { ok: false, reason: 'RESOURCE_NOT_FOUND' };

  const config = await loadPublicConfig(db, row.businessId);
  if (!config) return { ok: false, reason: 'BUSINESS_NOT_ACTIVE' };

  if (!row.isPrimary) {
    const expired = row.redirectUntil !== null && row.redirectUntil.getTime() < Date.now();
    if (expired) return { ok: false, reason: 'RESOURCE_NOT_FOUND' };
    return { ok: true, redirectTo: `/${config.slug}` };
  }

  return { ok: true, config: { ...config, qrCodeId: null, qrSourceLabel: null } };
}

async function loadPublicConfig(
  db: Database,
  businessId: string,
): Promise<Omit<PublicBusinessConfig, 'qrCodeId' | 'qrSourceLabel'> | null> {
  // Left-joined rather than selected separately: the logo is optional, and an inner join
  // would silently hide every business that has not uploaded one.
  const [business] = await db
    .select({
      id: businesses.id,
      name: businesses.name,
      status: businesses.status,
      deletedAt: businesses.deletedAt,
      logoStorageKey: assets.storageKey,
    })
    .from(businesses)
    .leftJoin(assets, eq(assets.id, businesses.logoAssetId))
    .where(eq(businesses.id, businessId))
    .limit(1);

  // Flow J: a suspended or draft tenant shows an unavailable state rather than its page.
  // deleted_at is checked too — a soft-deleted row left at ACTIVE would otherwise keep serving.
  if (!business || business.status !== 'ACTIVE' || business.deletedAt) return null;

  const [primarySlug] = await db
    .select({ slug: businessSlugs.slug })
    .from(businessSlugs)
    .where(and(eq(businessSlugs.businessId, businessId), eq(businessSlugs.isPrimary, true)))
    .limit(1);

  const [destination] = await db
    .select({ url: reviewDestinations.url, label: reviewDestinations.label })
    .from(reviewDestinations)
    .where(
      and(
        eq(reviewDestinations.businessId, businessId),
        eq(reviewDestinations.isPrimary, true),
        eq(reviewDestinations.isEnabled, true),
      ),
    )
    .limit(1);

  return {
    businessId: business.id,
    slug: primarySlug?.slug ?? '',
    name: business.name,
    logoUrl: buildAssetUrl(business.logoStorageKey),
    reviewUrl: destination?.url ?? null,
    reviewPlatformLabel: destination?.label ?? 'Google',
  };
}

/**
 * Resolves a stored object key to a public CDN URL.
 *
 * Returns null when the business has no logo or no CDN base is configured, so the caller
 * renders no image rather than a broken one.
 */
function buildAssetUrl(storageKey: string | null): string | null {
  if (!storageKey) return null;
  const base = process.env.S3_PUBLIC_BASE_URL;
  if (!base) return null;
  const trimmedBase = base.endsWith('/') ? base.slice(0, -1) : base;
  const trimmedKey = storageKey.startsWith('/') ? storageKey.slice(1) : storageKey;
  return `${trimmedBase}/${trimmedKey}`;
}

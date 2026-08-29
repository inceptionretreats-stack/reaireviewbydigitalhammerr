import { resolveByQrCode, resolveBySlug, type PublicBusinessConfig } from './public-business';
import { db } from './db';

/**
 * Resolves a public request to a tenant, server-side, from a slug or QR code.
 *
 * 02_System_Architecture.md is explicit: "Public AI endpoint uses signed/opaque public business
 * token or slug resolution server-side", and "Never expose internal ... admin IDs". Earlier
 * revisions shipped businesses.id to the browser and used whatever came back, which meant the
 * generate endpoint acted on a client-supplied UUID with no ownership or status check — anyone
 * could POST another business's id and burn its ten free generations.
 *
 * Now the browser only ever holds the public slug and the printed QR code, and every private
 * identifier is derived here.
 */

export interface ResolvedPublicRef {
  businessId: string;
  slug: string;
  qrCodeId: string | null;
  config: PublicBusinessConfig;
}

export type PublicRefOutcome =
  | { ok: true; ref: ResolvedPublicRef }
  | {
      ok: false;
      reason: 'RESOURCE_NOT_FOUND' | 'QR_NOT_FOUND' | 'QR_DISABLED' | 'BUSINESS_NOT_ACTIVE';
    };

export async function resolvePublicRef(input: {
  slug?: string | undefined;
  qrCode?: string | undefined;
}): Promise<PublicRefOutcome> {
  const database = db();

  // A QR code is more specific than a slug: it also carries source attribution, and its
  // disabled state (QR-01-02) must win over the business simply being reachable by slug.
  const resolution = input.qrCode
    ? await resolveByQrCode(database, input.qrCode)
    : input.slug
      ? await resolveBySlug(database, input.slug)
      : null;

  if (!resolution) return { ok: false, reason: 'RESOURCE_NOT_FOUND' };
  if (!resolution.ok) return { ok: false, reason: resolution.reason };

  // A retired-slug redirect is not a valid target for a mutation.
  if (!('config' in resolution)) return { ok: false, reason: 'RESOURCE_NOT_FOUND' };

  const { config } = resolution;

  return {
    ok: true,
    ref: {
      businessId: config.businessId,
      slug: config.slug,
      qrCodeId: config.qrCodeId,
      config,
    },
  };
}

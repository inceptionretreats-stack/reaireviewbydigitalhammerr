/**
 * Business slug rules (ONB-01, Flow I).
 *
 * Slugs are the public identity: review.digitalhammerr.com/{businessSlug}. They live in one
 * namespace shared with retired aliases (AMENDMENT-005), and comparison is case-insensitive
 * (ONB-01-01) because the column is citext.
 */

export const SLUG_MIN_LENGTH = 3;
export const SLUG_MAX_LENGTH = 48;

/**
 * Paths the public router owns. A business may not take one of these as its slug, or it would
 * shadow a platform route — /r/ in particular is the dynamic QR namespace (ADR-002).
 */
export const RESERVED_SLUGS = new Set([
  'r',
  'api',
  'app',
  'admin',
  'auth',
  'login',
  'logout',
  'signup',
  'onboarding',
  'dashboard',
  'settings',
  'support',
  'help',
  'about',
  'terms',
  'privacy',
  'legal',
  'pricing',
  'static',
  'assets',
  'public',
  'cdn',
  'www',
  'mail',
  'review',
  'reviews',
  'feedback',
  'health',
  'status',
  'webhooks',
  'digitalhammerr',
]);

export type SlugRejection =
  | 'TOO_SHORT'
  | 'TOO_LONG'
  | 'INVALID_CHARACTERS'
  | 'LEADING_OR_TRAILING_HYPHEN'
  | 'CONSECUTIVE_HYPHENS'
  | 'RESERVED'
  | 'NUMERIC_ONLY';

export type SlugValidation = { ok: true; slug: string } | { ok: false; reason: SlugRejection };

/**
 * Normalizes a candidate into slug form. Lossy by design — it is used to *suggest* a slug from
 * a business name, not to accept arbitrary input. Always validate the result.
 */
export function normalizeSlug(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function validateSlug(candidate: string): SlugValidation {
  const slug = candidate.toLowerCase().trim();

  // Checked before length: several reserved routes ('r', 'api') are shorter than the
  // minimum, and reporting TOO_SHORT for them would be actively misleading.
  if (RESERVED_SLUGS.has(slug)) return { ok: false, reason: 'RESERVED' };
  if (slug.length < SLUG_MIN_LENGTH) return { ok: false, reason: 'TOO_SHORT' };
  if (slug.length > SLUG_MAX_LENGTH) return { ok: false, reason: 'TOO_LONG' };
  if (!/^[a-z0-9-]+$/.test(slug)) return { ok: false, reason: 'INVALID_CHARACTERS' };
  if (slug.startsWith('-') || slug.endsWith('-')) {
    return { ok: false, reason: 'LEADING_OR_TRAILING_HYPHEN' };
  }
  if (slug.includes('--')) return { ok: false, reason: 'CONSECUTIVE_HYPHENS' };
  // A purely numeric slug is ambiguous against future numeric routes and reads as an ID.
  if (/^[0-9]+$/.test(slug)) return { ok: false, reason: 'NUMERIC_ONLY' };

  return { ok: true, slug };
}

/** Suggests fallbacks when the preferred slug is taken, e.g. from the city or a suffix. */
export function suggestSlugs(base: string, hints: string[] = []): string[] {
  const normalized = normalizeSlug(base);
  const candidates = [
    normalized,
    ...hints.map((h) => normalizeSlug(`${base}-${h}`)),
    ...[2, 3, 4].map((n) => `${normalized}-${n}`),
  ];

  return candidates.filter((c) => validateSlug(c).ok).filter((c, i, all) => all.indexOf(c) === i);
}

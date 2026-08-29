/**
 * Google review destination validation (ONB-02).
 *
 * ONB-02-01 requires HTTPS, ONB-02-02 accepts google.com / maps.app.goo.gl patterns, and
 * ONB-02-03 stores the URL normalized. This matters more than typical URL validation: the
 * stored URL is where every customer is sent after copying their draft, so a merchant typo
 * silently sends real traffic nowhere.
 *
 * Deliberately permissive about the *path* within a known Google host — Google has changed
 * review-link formats repeatedly, and rejecting an unfamiliar-but-valid shape would block a
 * legitimate business from onboarding.
 */

const GOOGLE_REVIEW_HOSTS = new Set([
  'g.page',
  'goo.gl',
  'maps.app.goo.gl',
  'maps.google.com',
  'search.google.com',
  'www.google.com',
  'google.com',
]);

/** Tracking parameters stripped on normalization so stored URLs stay stable and comparable. */
const STRIPPED_PARAMS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'fbclid',
  'gclid',
  '_ga',
];

export type ReviewUrlRejection =
  'NOT_A_URL' | 'NOT_HTTPS' | 'UNSUPPORTED_HOST' | 'MISSING_PLACE_REFERENCE';

export type ReviewUrlValidation =
  { ok: true; url: string; host: string } | { ok: false; reason: ReviewUrlRejection };

export function validateGoogleReviewUrl(input: string): ReviewUrlValidation {
  const trimmed = input.trim();

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, reason: 'NOT_A_URL' };
  }

  // ONB-02-01. http:// is rejected rather than upgraded — silently rewriting a merchant's
  // destination is the wrong default for a field that redirects real customers.
  if (parsed.protocol !== 'https:') {
    return { ok: false, reason: 'NOT_HTTPS' };
  }

  const host = parsed.hostname.toLowerCase();
  if (!GOOGLE_REVIEW_HOSTS.has(host)) {
    return { ok: false, reason: 'UNSUPPORTED_HOST' };
  }

  // A bare google.com with no path is a merchant pasting the wrong thing entirely.
  const hasReference =
    parsed.pathname.replace(/\/+$/, '').length > 0 || parsed.searchParams.size > 0;
  if (!hasReference) {
    return { ok: false, reason: 'MISSING_PLACE_REFERENCE' };
  }

  return { ok: true, url: normalizeGoogleReviewUrl(parsed), host };
}

/** ONB-02-03: lowercase host, drop tracking params and any fragment, trim trailing slash. */
export function normalizeGoogleReviewUrl(input: URL | string): string {
  const url = typeof input === 'string' ? new URL(input.trim()) : new URL(input.toString());

  url.hostname = url.hostname.toLowerCase();
  url.hash = '';
  for (const param of STRIPPED_PARAMS) {
    url.searchParams.delete(param);
  }

  let result = url.toString();
  if (url.pathname !== '/' && result.endsWith('/')) {
    result = result.slice(0, -1);
  }
  return result;
}

export function describeReviewUrlRejection(reason: ReviewUrlRejection): string {
  switch (reason) {
    case 'NOT_A_URL':
      return 'That does not look like a web address. Paste the full link, starting with https://';
    case 'NOT_HTTPS':
      return 'The link must start with https://';
    case 'UNSUPPORTED_HOST':
      return 'That is not a Google link. Use your Google review link or Maps short link.';
    case 'MISSING_PLACE_REFERENCE':
      return 'That link does not point to a specific business. Copy your review link from Google.';
  }
}

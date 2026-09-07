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

/**
 * Where the stored link actually lands the customer.
 *
 * The distinction the product lives on. `composer` opens Google's write-a-review dialog with the
 * box ready for a paste; `listing` opens the business page, where the customer has to find
 * "Write a review" themselves. Both are valid Google links and ONB-02-02 accepts both, so nothing
 * here rejects a listing — but a customer who has just copied their words and is looking at a map
 * is one tap from giving up, and the owner should be told that rather than left to discover it.
 */
export type ReviewDestinationKind = 'composer' | 'listing' | 'unknown';

export type ReviewUrlValidation =
  | { ok: true; url: string; host: string; kind: ReviewDestinationKind }
  | { ok: false; reason: ReviewUrlRejection };

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

  const upgraded = upgradeToComposer(parsed);
  return {
    ok: true,
    url: normalizeGoogleReviewUrl(upgraded),
    host,
    kind: classifyReviewDestination(upgraded),
  };
}

/**
 * Rewrites a link to the review composer where that can be done safely.
 *
 * Two cases only, both documented and lossless:
 *
 *  - `g.page/r/{code}` is the Business Profile short link; adding `/review` is what Google's own
 *    "Ask for reviews" produces, and the bare form is the commonest thing an owner copies from
 *    their profile header by mistake.
 *  - anything already carrying a `placeid` is expressed directly as the writereview endpoint.
 *
 * A Maps share link is deliberately *not* converted. Turning `maps.app.goo.gl/…` into a composer
 * link needs the place id, which is only obtainable from the Places API — explicitly out of scope
 * for V1 — and guessing at an undocumented URL shape would send real customers somewhere that
 * silently stops working. It is classified as a listing and reported instead.
 */
export function upgradeToComposer(input: URL | string): URL {
  const url = typeof input === 'string' ? new URL(input.trim()) : new URL(input.toString());
  const host = url.hostname.toLowerCase();

  const placeId = url.searchParams.get('placeid') ?? url.searchParams.get('place_id');
  if (placeId) {
    const composer = new URL('https://search.google.com/local/writereview');
    composer.searchParams.set('placeid', placeId);
    return composer;
  }

  if (host === 'g.page') {
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments[0] === 'r' && segments.length === 2) {
      url.pathname = `/r/${segments[1]}/review`;
      return url;
    }
  }

  return url;
}

export function classifyReviewDestination(input: URL | string): ReviewDestinationKind {
  const url = typeof input === 'string' ? new URL(input.trim()) : new URL(input.toString());
  const host = url.hostname.toLowerCase();
  const path = url.pathname.toLowerCase();

  if (host === 'search.google.com' && path.startsWith('/local/writereview')) return 'composer';
  if (host === 'g.page' && path.endsWith('/review')) return 'composer';

  // A Maps place or share link. It resolves to the business page, not the review box.
  if (host === 'maps.app.goo.gl' || host === 'maps.google.com') return 'listing';
  if (path.startsWith('/maps')) return 'listing';

  return 'unknown';
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

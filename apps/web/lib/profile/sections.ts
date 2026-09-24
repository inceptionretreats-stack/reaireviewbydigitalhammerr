/**
 * What a public profile section *is* — the vocabulary PROFILE-01's editor and the two endpoints
 * behind it both read.
 *
 * One module rather than two copies, because PROFILE-01-02 ("a section with a blank target cannot
 * be enabled") has to be stated identically on both sides of the wire: the database enforces it as
 * `ck_enabled_link_has_target`, the endpoint has to refuse it as a readable 422, and the screen has
 * to explain it before the owner ever tries. Three independent copies of that rule is precisely how
 * a screen ends up explaining a constraint the endpoint does not apply.
 *
 * Imported by the profile editor and by `app/api/v1/business/links/**`. It carries no React
 * import, no `'use client'` and nothing server-only, so it is safe in a route handler and in a
 * browser bundle alike.
 */

/** `business_links.link_type`, in the order `packages/db/src/schema/enums.ts` declares it. */
export const SECTION_TYPES = [
  'GOOGLE_REVIEW',
  'WHATSAPP',
  'CALL',
  'INSTAGRAM',
  'FACEBOOK',
  'WEBSITE',
  'DIRECTIONS',
  'CUSTOM',
] as const;

export type SectionType = (typeof SECTION_TYPES)[number];

/**
 * The D-014 defaults, in the order the Decision Log lists them.
 *
 * PROFILE-01-01 says these five *exist*, which is why they can be hidden and reordered (D-015) but
 * never deleted: removing one would take the acceptance note with it, and nothing in V1 could put
 * it back. DELETE therefore refuses them and points at Hide instead.
 */
export const DEFAULT_SECTION_TYPES: readonly SectionType[] = [
  'GOOGLE_REVIEW',
  'WHATSAPP',
  'CALL',
  'INSTAGRAM',
  'FACEBOOK',
];

/**
 * What a section points at.
 *
 * `'none'` is GOOGLE_REVIEW alone, and it is not an unhandled case. AMENDMENT-003 makes that row
 * presentation only — `review_destinations` owns the URL, which is what makes AC-017 work — and
 * `ck_google_review_has_no_url` stops it carrying one. So this screen offers no url field for it
 * anywhere, and the endpoint refuses one.
 */
export type SectionTarget = 'none' | 'url' | 'phone';

export interface SectionDescriptor {
  /** The section's name on the editing screen. The stored label is what the button itself says. */
  name: string;
  target: SectionTarget;
  /** Label for the target input. Empty when `target` is `'none'`, which renders no input. */
  targetLabel: string;
  /** Guidance under that input. Wording matches ONB-03 so the two screens agree. */
  hint: string;
}

export const SECTION: Record<SectionType, SectionDescriptor> = {
  GOOGLE_REVIEW: {
    name: 'Review Us',
    target: 'none',
    targetLabel: '',
    hint: 'Opens your Google review page.',
  },
  WHATSAPP: {
    name: 'WhatsApp',
    target: 'phone',
    targetLabel: 'WhatsApp number',
    hint: 'Opens a chat with you. 10 digits, or start with + and a country code.',
  },
  CALL: {
    name: 'Call',
    target: 'phone',
    targetLabel: 'Call number',
    hint: 'Dials this number when a visitor taps the button.',
  },
  INSTAGRAM: {
    name: 'Instagram',
    target: 'url',
    targetLabel: 'Instagram URL',
    hint: 'The full address of your profile, starting with https://',
  },
  FACEBOOK: {
    name: 'Facebook',
    target: 'url',
    targetLabel: 'Facebook URL',
    hint: 'The full address of your page, starting with https://',
  },
  WEBSITE: {
    name: 'Website',
    target: 'url',
    targetLabel: 'Website URL',
    hint: 'Your own site, starting with https://',
  },
  DIRECTIONS: {
    name: 'Directions',
    target: 'url',
    targetLabel: 'Directions URL',
    hint: 'A map link that opens directions to you, starting with https://',
  },
  CUSTOM: {
    name: 'Custom link',
    target: 'url',
    targetLabel: 'Link URL',
    hint: 'Any other link you want on your page, starting with https://',
  },
};

/** `business_links.label` is varchar(80). */
export const SECTION_LABEL_MAX = 80;

/** `business_links.phone` is varchar(20). */
export const SECTION_PHONE_MAX = 20;

export function isSectionType(value: string): value is SectionType {
  return (SECTION_TYPES as readonly string[]).includes(value);
}

export function isDefaultSectionType(type: SectionType): boolean {
  return DEFAULT_SECTION_TYPES.includes(type);
}

/**
 * The stored shape of one section, as both the editor and the endpoints handle it.
 *
 * `url` and `phone` are `string | null` in the database, but the editor holds them as the strings an
 * `<input>` produces. Every predicate below therefore accepts `''` and treats it as absent — which
 * is not a convenience: the endpoint stores an empty target as NULL, so `''` and `null` describe the
 * same row.
 */
export interface SectionRecord {
  type: SectionType;
  url: string | null;
  phone: string | null;
}

export function sectionTarget(type: SectionType): SectionTarget {
  return SECTION[type].target;
}

/**
 * Whether this section has somewhere to point — the exact condition of
 * `ck_enabled_link_has_target` (AMENDMENT-013), which is what makes PROFILE-01-02 a database rule
 * rather than a convention.
 *
 * GOOGLE_REVIEW counts as targeted because its destination is not stored on the row at all. Whether
 * it is publicly renderable is a different question, answered by `rendersPublicly`.
 */
export function hasStoredTarget(section: SectionRecord): boolean {
  if (section.type === 'GOOGLE_REVIEW') return true;
  return present(section.url) || present(section.phone);
}

/**
 * Whether a visitor would actually see this section — the editor's mirror of AC-020.
 *
 * AC-020 requires a disabled or empty section to be *absent* from the public HTML, and
 * `app/(customer)/[slug]/page.tsx` enforces that twice: disabled rows are excluded in SQL, and a row whose
 * target does not resolve is dropped in `resolveSection`. The preview has to agree with that, or it
 * shows the owner a button their customers never get.
 *
 * It answers "is there a target", not "does the target resolve": every value this screen and ONB-03
 * store is already normalised (https for a url, E.164 for a phone), so presence is the only
 * remaining question for anything they wrote. The one gap is a row written by the seed or a future
 * import — `scripts/seed.ts` validates neither scheme nor dialability — where a WhatsApp number
 * that cannot be resolved to a country code is dropped publicly but still shown here.
 */
export function rendersPublicly(
  section: SectionRecord & { enabled: boolean },
  reviewUrl: string | null,
): boolean {
  if (!section.enabled) return false;

  // AMENDMENT-003: the destination lives in review_destinations, so with none set the Review Us
  // button has nothing to open and the public page omits it — however this row is configured.
  if (section.type === 'GOOGLE_REVIEW') return present(reviewUrl);

  // WHATSAPP is the one dialling section with a second way to resolve, and this has to say so or it
  // contradicts the page it mirrors: `resolveTarget` in `app/(customer)/[slug]/page.tsx` resolves it as
  // `whatsAppHref(link.phone) ?? externalHref(link.url)`, so a row carrying only a pasted wa.me or
  // chat link renders a live button (AC-020). CALL has no such fallback — a url on it is ignored
  // publicly — so the two dialling sections are deliberately not one rule.
  if (section.type === 'WHATSAPP') return present(section.phone) || present(section.url);

  return sectionTarget(section.type) === 'phone' ? present(section.phone) : present(section.url);
}

function present(value: string | null): boolean {
  return value !== null && value.trim().length > 0;
}

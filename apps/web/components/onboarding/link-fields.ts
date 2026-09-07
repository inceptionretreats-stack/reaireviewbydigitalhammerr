/**
 * ONB-03 field logic, kept out of `LinksStep.tsx` so it can be tested.
 *
 * The unit suite is node-only and collects `**\/*.test.ts` (vitest.config.mts), so a `.tsx`
 * component test would never run. These four functions carry every rule on the screen that can be
 * wrong — a phone mirror of a core validator, scheme repair, canonicalisation and the summary
 * state machine — so they live in a `.ts` module that a test can import directly. Anything that
 * needs React stays in the component.
 */

/**
 * The inputs this screen collects, which are exactly the D-014 defaults it can write.
 *
 * There is deliberately no `website` here even though 03_Screen_Field_Button_Spec.md lists
 * "Website URL (optional)" under ONB-03: see the note on FIELDS in LinksStep.tsx.
 */
export type FieldId = 'whatsapp' | 'call' | 'instagram' | 'facebook';

/** Whatever is already stored, keyed exactly as the inputs are. */
export type SavedContactLinks = Record<FieldId, string>;

/** A section points at a phone number or at a web address, never at both. */
export type FieldKind = 'phone' | 'url';

/**
 * What a section is currently doing, said in words rather than carried by badge colour alone
 * (AC-038, and the design brief rule on never conveying state by colour).
 */
export type SectionState = 'saved' | 'pending' | 'removing' | 'invalid' | 'empty';

export function sectionState({
  current,
  stored,
  invalid,
}: {
  current: string;
  stored: string;
  invalid: boolean;
}): SectionState {
  if (invalid) return 'invalid';
  if (current.length === 0) return stored.length > 0 ? 'removing' : 'empty';
  return current === stored ? 'saved' : 'pending';
}

export function canonicalValue(kind: FieldKind, raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return '';
  if (kind !== 'phone') return trimmed;

  // An un-normalisable number is passed through unchanged so validation can report it, rather
  // than being quietly rewritten into something the owner did not type.
  return normalizeMobile(trimmed) ?? trimmed;
}

/**
 * Client-side mirror of `normalizePhone` (packages/core) for immediate feedback.
 *
 * Not an import, which is the awkward part and worth stating plainly: `@ai-review/core` publishes
 * only its barrel, and that barrel reaches @node-rs/argon2 and ioredis, so it cannot go into a
 * client bundle. The server value stays authoritative — this exists to catch a typo before a
 * round trip and to canonicalise for the summary. Same India-first rules (D-002): a bare
 * 10-digit number is +91, and only Indian numbers get a shape check.
 *
 * Because it is a copy it can drift, and drift here is worse than no check at all: this runs
 * *before* the fetch, so anything it rejects can never reach the server that would have accepted
 * it. `__tests__/link-fields.test.ts` pins it against `normalizePhone` itself for that reason.
 */
export function normalizeMobile(input: string): string | null {
  const cleaned = input.replace(/[^\d+]/g, '');
  if (cleaned.length === 0) return null;

  if (cleaned.startsWith('+') && !cleaned.startsWith('+91')) {
    const digits = cleaned.slice(1);
    if (!/^\d+$/.test(digits)) return null;
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }

  // '00' is the international access code, not a trunk zero — phone.ts re-enters itself with '+'
  // for it, so '00447911123456' is a UK number to the server. Without this branch the zeros were
  // stripped and the rest judged as an Indian national number, which fails the 6-9 shape check:
  // the owner was blocked with "Enter a valid 10-digit mobile number." on a value the handler
  // would have stored. D-002 makes +91 the default for *domestic* input only.
  if (cleaned.startsWith('00')) return normalizeMobile(`+${cleaned.slice(2)}`);

  // Strip a trunk prefix first, then an embedded country code: '091-9876543210' carries both,
  // and testing for the country code before dropping the zero leaves 12 digits that fail.
  const digits = cleaned.replace(/\D/g, '').replace(/^0+/, '');
  const national = digits.length > 10 && digits.startsWith('91') ? digits.slice(2) : digits;

  // Indian mobile numbers begin 6-9.
  return /^[6-9]\d{9}$/.test(national) ? `+91${national}` : null;
}

/** Mirrors the handler's own check: only https is stored, so only https is accepted here. */
export function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Adds the scheme an owner pasting "instagram.com/mycafe" left off.
 *
 * A value that already carries a scheme is never touched — silently promoting http:// to https://
 * would change where the button points, which is not a formatting fix.
 */
export function withHttps(value: string): string {
  const trimmed = value.trim().replace(/^\/+/, '');
  if (trimmed.length === 0) return '';
  if (/^[a-z][a-z\d+.-]*:/i.test(trimmed)) return trimmed;
  return trimmed.includes('.') ? `https://${trimmed}` : trimmed;
}

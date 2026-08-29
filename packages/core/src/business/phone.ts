/**
 * Phone normalization (CRM-01-03, ONB-03, AUTH-01).
 *
 * India-first (D-002), so a bare 10-digit number is assumed +91. Stored E.164 because the
 * WhatsApp deep link in REQ-01-01 needs a country code, and because a normalized value is what
 * makes the customer-by-mobile index in the schema actually useful.
 */

const DEFAULT_COUNTRY_CODE = '91';

export type PhoneRejection = 'EMPTY' | 'TOO_SHORT' | 'TOO_LONG' | 'INVALID_INDIAN_MOBILE';

export type PhoneValidation = { ok: true; e164: string } | { ok: false; reason: PhoneRejection };

export function normalizePhone(
  input: string,
  defaultCountry = DEFAULT_COUNTRY_CODE,
): PhoneValidation {
  const digitsOnly = input.replace(/[^\d+]/g, '');
  if (digitsOnly.length === 0) return { ok: false, reason: 'EMPTY' };

  let national: string;
  let country: string;

  if (digitsOnly.startsWith('+')) {
    const rest = digitsOnly.slice(1);
    if (rest.startsWith(defaultCountry)) {
      country = defaultCountry;
      national = rest.slice(defaultCountry.length);
    } else {
      // Another country code. Accept it, but only Indian numbers get shape validation.
      if (rest.length < 8) return { ok: false, reason: 'TOO_SHORT' };
      if (rest.length > 15) return { ok: false, reason: 'TOO_LONG' };
      return { ok: true, e164: `+${rest}` };
    }
  } else if (digitsOnly.startsWith('00')) {
    return normalizePhone(`+${digitsOnly.slice(2)}`, defaultCountry);
  } else {
    // Strip any domestic trunk prefix first, then look for an embedded country code.
    // Order matters: '091-9876543210' carries both, and checking for the country code
    // before stripping the zero leaves a 12-digit national number that fails as TOO_LONG.
    const rest = digitsOnly.replace(/^0+/, '');
    country = defaultCountry;
    national =
      rest.length > 10 && rest.startsWith(defaultCountry)
        ? rest.slice(defaultCountry.length)
        : rest;
  }

  if (country === DEFAULT_COUNTRY_CODE) {
    if (national.length < 10) return { ok: false, reason: 'TOO_SHORT' };
    if (national.length > 10) return { ok: false, reason: 'TOO_LONG' };
    // Indian mobile numbers begin 6-9.
    if (!/^[6-9]\d{9}$/.test(national)) {
      return { ok: false, reason: 'INVALID_INDIAN_MOBILE' };
    }
  }

  return { ok: true, e164: `+${country}${national}` };
}

/**
 * wa.me deep link for REQ-01. The platform never sends the message (D-017, ADR-004) — this
 * only opens WhatsApp with text prefilled so the owner sends it from their own number.
 */
export function buildWhatsAppLink(e164: string, message: string): string {
  const digits = e164.replace(/\D/g, '');
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

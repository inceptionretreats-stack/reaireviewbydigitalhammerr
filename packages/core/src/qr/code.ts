import { randomInt } from 'node:crypto';

/**
 * Opaque dynamic QR codes (ADR-002, D-026, QR-01-01).
 *
 * The code is printed on physical standees and can never change, so it must not encode
 * anything that can: not the slug, not the Google URL, not the custom domain. It is a pure
 * locator that the server resolves.
 *
 * The alphabet excludes 0/O and 1/I/L because these end up read aloud over a phone and
 * hand-typed from a printed standee when a scan fails.
 */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const DEFAULT_LENGTH = 10;

/**
 * 31^10 is about 8.2e14. Against the 10,000-tenant target with a handful of QRs each, a
 * collision is vanishingly unlikely — but the column is UNIQUE and creation retries, because
 * "unlikely" is not "impossible" and a collision would silently redirect one business's
 * customers to another.
 */
export function generateQrCode(length = DEFAULT_LENGTH): string {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += ALPHABET[randomInt(ALPHABET.length)];
  }
  return out;
}

/** RBAC rule 3: a QR code is a locator, never an authorization token for private data. */
export function isValidQrCodeFormat(code: string): boolean {
  return code.length >= 6 && code.length <= 32 && new RegExp(`^[${ALPHABET}]+$`).test(code);
}

/**
 * Normalizes a hand-typed code to uppercase.
 *
 * No character remapping: the alphabet already excludes every confusable pair (0/O, 1/I/L),
 * so an ambiguous character cannot appear in a valid code and there is nothing to map it to.
 * Designing the confusion out of the alphabet is what makes a normalizer unnecessary.
 */
export function normalizeQrCode(input: string): string {
  return input.trim().toUpperCase();
}

export function buildQrUrl(baseUrl: string, code: string): string {
  return new URL(`/r/${code}`, baseUrl).toString();
}

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * TOTP (RFC 6238) over HOTP (RFC 4226), SHA-1, six digits, thirty-second steps — the profile
 * every authenticator app implements. Written on `node:crypto` rather than pulled in as a
 * dependency: the whole algorithm is one HMAC and a truncation, and a dependency here would be
 * a second implementation of something the test vectors already pin.
 *
 * Verification is constant-time per candidate and accepts one step either side (a phone whose
 * clock is up to 30 s out). A code is accepted at most once: the caller stores the step that
 * was accepted and passes it back as `notBeforeStep`, so the same code cannot be replayed
 * inside its window.
 */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;

/** RFC 4648 base32, no padding — the alphabet authenticator apps read from a QR or by hand. */
export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** Tolerant of case, spaces, hyphens and trailing '=' — what a person types from a manual key. */
export function base32Decode(text: string): Uint8Array {
  const clean = text.toUpperCase().replace(/[\s-]/g, '').replace(/=+$/, '');
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) throw new Error('not a base32 string');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Uint8Array.from(out);
}

/** 160 bits, the size RFC 4226 recommends for HMAC-SHA-1. */
export function generateTotpSecret(bytes = 20): Uint8Array {
  return new Uint8Array(randomBytes(bytes));
}

/** HOTP: HMAC-SHA-1 of the big-endian counter, dynamically truncated to `digits` digits. */
export function hotp(secret: Uint8Array, counter: bigint, digits = TOTP_DIGITS): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(counter);
  const mac = createHmac('sha1', Buffer.from(secret)).update(message).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const binary =
    ((mac[offset]! & 0x7f) << 24) |
    ((mac[offset + 1]! & 0xff) << 16) |
    ((mac[offset + 2]! & 0xff) << 8) |
    (mac[offset + 3]! & 0xff);
  return String(binary % 10 ** digits).padStart(digits, '0');
}

export interface TotpOptions {
  timeMs?: number;
  stepSeconds?: number;
  digits?: number;
}

export function totpStep(timeMs: number, stepSeconds = TOTP_STEP_SECONDS): bigint {
  return BigInt(Math.floor(timeMs / 1000 / stepSeconds));
}

export function totp(secret: Uint8Array, options: TotpOptions = {}): string {
  const step = totpStep(options.timeMs ?? Date.now(), options.stepSeconds ?? TOTP_STEP_SECONDS);
  return hotp(secret, step, options.digits ?? TOTP_DIGITS);
}

export interface VerifyTotpOptions extends TotpOptions {
  /** Steps accepted either side of now. One means ±30 s. */
  window?: number;
  /** The last step that was accepted for this secret; a step at or before it is a replay. */
  notBeforeStep?: bigint | null;
}

export type TotpVerification =
  { ok: true; step: bigint } | { ok: false; reason: 'INVALID' | 'REPLAY' };

/**
 * Checks every candidate step in constant time before answering, so the time taken does not
 * say which step (if any) matched. A replayed code — one whose step was already accepted — is
 * reported separately so the caller can count it as a failure without confusing the person.
 */
export function verifyTotp(
  secret: Uint8Array,
  code: string,
  options: VerifyTotpOptions = {},
): TotpVerification {
  const digits = options.digits ?? TOTP_DIGITS;
  const window = options.window ?? 1;
  const candidate = code.replace(/\s/g, '');
  if (!/^\d+$/.test(candidate) || candidate.length !== digits)
    return { ok: false, reason: 'INVALID' };

  const now = totpStep(options.timeMs ?? Date.now(), options.stepSeconds ?? TOTP_STEP_SECONDS);
  const candidateBuffer = Buffer.from(candidate, 'utf8');
  let matched: bigint | null = null;
  for (let delta = -window; delta <= window; delta += 1) {
    const step = now + BigInt(delta);
    if (step < 0n) continue;
    const expected = Buffer.from(hotp(secret, step, digits), 'utf8');
    if (expected.length === candidateBuffer.length && timingSafeEqual(expected, candidateBuffer)) {
      matched = matched ?? step;
    }
  }
  if (matched === null) return { ok: false, reason: 'INVALID' };
  if (options.notBeforeStep != null && matched <= options.notBeforeStep) {
    return { ok: false, reason: 'REPLAY' };
  }
  return { ok: true, step: matched };
}

/** The URI an authenticator app reads from the enrolment QR. */
export function otpauthUri(input: {
  issuer: string;
  account: string;
  secretBase32: string;
}): string {
  const label = `${input.issuer}:${input.account}`;
  const params = new URLSearchParams({
    secret: input.secretBase32,
    issuer: input.issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`;
}

/** The manual-entry form of a key: groups of four, easier to type than one long string. */
export function formatManualKey(secretBase32: string): string {
  return secretBase32.replace(/(.{4})(?=.)/g, '$1 ');
}

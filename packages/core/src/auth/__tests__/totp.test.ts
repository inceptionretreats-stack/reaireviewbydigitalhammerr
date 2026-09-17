import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  formatManualKey,
  hotp,
  otpauthUri,
  totp,
  verifyTotp,
} from '../totp';

/**
 * RFC 6238 Appendix B, SHA-1 column. The secret is the ASCII string "12345678901234567890".
 * If these vectors pass, an authenticator app and this server agree on every code.
 */
const SECRET = new TextEncoder().encode('12345678901234567890');
const VECTORS: Array<[seconds: number, code: string]> = [
  [59, '287082'],
  [1111111109, '081804'],
  [1111111111, '050471'],
  [1234567890, '005924'],
  [2000000000, '279037'],
  [20000000000, '353130'],
];

describe('totp', () => {
  it('reproduces the RFC 6238 test vectors', () => {
    for (const [seconds, code] of VECTORS) {
      expect(totp(SECRET, { timeMs: seconds * 1000 })).toBe(code);
    }
  });

  it('is HOTP over the time step', () => {
    expect(hotp(SECRET, 1n)).toBe('287082');
    expect(hotp(SECRET, 37037036n)).toBe('081804');
  });

  it('accepts a code from the neighbouring steps and nothing further', () => {
    const at = 1111111111 * 1000; // step 37037037
    expect(verifyTotp(SECRET, '050471', { timeMs: at })).toEqual({ ok: true, step: 37037037n });
    // Previous step (T=1111111109 → 081804) is inside the ±1 window.
    expect(verifyTotp(SECRET, '081804', { timeMs: at })).toEqual({ ok: true, step: 37037036n });
    // Two steps earlier is not.
    expect(verifyTotp(SECRET, hotp(SECRET, 37037035n), { timeMs: at })).toEqual({
      ok: false,
      reason: 'INVALID',
    });
    expect(verifyTotp(SECRET, '000000', { timeMs: at })).toEqual({ ok: false, reason: 'INVALID' });
    expect(verifyTotp(SECRET, '05047', { timeMs: at })).toEqual({ ok: false, reason: 'INVALID' });
    expect(verifyTotp(SECRET, '05047a', { timeMs: at })).toEqual({ ok: false, reason: 'INVALID' });
  });

  it('refuses a code whose step was already accepted', () => {
    const at = 1111111111 * 1000;
    expect(verifyTotp(SECRET, '050471', { timeMs: at, notBeforeStep: 37037037n })).toEqual({
      ok: false,
      reason: 'REPLAY',
    });
    expect(verifyTotp(SECRET, '050471', { timeMs: at, notBeforeStep: 37037036n })).toEqual({
      ok: true,
      step: 37037037n,
    });
  });

  it('tolerates spaces in what a person types', () => {
    expect(verifyTotp(SECRET, '050 471', { timeMs: 1111111111 * 1000 }).ok).toBe(true);
  });
});

describe('base32', () => {
  it('round-trips and reads lowercase, spaced and padded input', () => {
    const encoded = base32Encode(SECRET);
    expect(encoded).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(base32Decode(encoded)).toEqual(SECRET);
    expect(base32Decode('gezd gnbv gy3t qojq gezd gnbv gy3t qojq==')).toEqual(SECRET);
    expect(base32Decode(formatManualKey(encoded))).toEqual(SECRET);
    expect(() => base32Decode('not*valid')).toThrow();
  });

  it('encodes lengths that do not divide by five without padding characters', () => {
    const bytes = Uint8Array.from([1, 2, 3]);
    const text = base32Encode(bytes);
    expect(text).not.toContain('=');
    expect(base32Decode(text)).toEqual(bytes);
  });
});

describe('otpauthUri', () => {
  it('escapes the label and carries the parameters an app expects', () => {
    const uri = otpauthUri({
      issuer: 'Ai Review by Digital Hammerr',
      account: 'admin@digitalhammerr.com',
      secretBase32: 'GEZDGNBV',
    });
    expect(uri.startsWith('otpauth://totp/Ai%20Review%20by%20Digital%20Hammerr%3Aadmin%40')).toBe(
      true,
    );
    const params = new URL(uri).searchParams;
    expect(params.get('secret')).toBe('GEZDGNBV');
    expect(params.get('issuer')).toBe('Ai Review by Digital Hammerr');
    expect(params.get('algorithm')).toBe('SHA1');
    expect(params.get('digits')).toBe('6');
    expect(params.get('period')).toBe('30');
  });
});

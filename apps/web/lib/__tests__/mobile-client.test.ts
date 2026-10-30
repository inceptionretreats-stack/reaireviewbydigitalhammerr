import { describe, expect, it } from 'vitest';
import { bearerToken, isMobileClient, mobileSessionBody } from '../mobile-client';

describe('bearerToken', () => {
  it('reads the token from a Bearer header', () => {
    expect(bearerToken(new Headers({ authorization: 'Bearer abc.DEF-123_' }))).toBe('abc.DEF-123_');
  });

  it('accepts the scheme case-insensitively and trims surrounding space', () => {
    expect(bearerToken(new Headers({ authorization: '  bearer   tok  ' }))).toBe('tok');
  });

  it.each(['', 'Bearer', 'Bearer ', 'Basic dXNlcjpwYXNz', 'Bearer two tokens', 'tok'])(
    'returns null for %j',
    (value) => {
      expect(bearerToken(new Headers(value ? { authorization: value } : {}))).toBeNull();
    },
  );
});

describe('isMobileClient', () => {
  it('recognises only the exact app marker', () => {
    expect(isMobileClient(new Headers({ 'x-client': 'ai-review-mobile' }))).toBe(true);
    expect(isMobileClient(new Headers({ 'x-client': 'AI-REVIEW-MOBILE' }))).toBe(false);
    expect(isMobileClient(new Headers())).toBe(false);
  });
});

describe('mobileSessionBody', () => {
  it('serialises the expiry as ISO 8601', () => {
    expect(
      mobileSessionBody({ token: 't', expiresAt: new Date('2026-11-01T00:00:00.000Z') }),
    ).toEqual({ token: 't', expires_at: '2026-11-01T00:00:00.000Z' });
  });
});

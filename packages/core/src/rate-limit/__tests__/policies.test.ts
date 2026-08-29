import { describe, expect, it } from 'vitest';
import { ipPrefixHash } from '../../auth/tokens';
import {
  adaptiveIpPrefixLimit,
  DEFAULT_RATE_LIMIT_CONFIG,
  ipSessionSetKey,
  looksLikeIpAddress,
  loginFailureCheck,
  loginIdentityHash,
  publicGenerationCheck,
  rateLimitKey,
  RateLimitKeyError,
  type PublicGenerationSubject,
  type RateLimitConfig,
} from '../policies';

const PEPPER = 'test-pepper';

const subject: PublicGenerationSubject = {
  businessId: '4f3c9a1e-0000-4000-8000-000000000001',
  anonymousSessionId: 'anon-session-abc',
  ip: '203.0.113.42',
  pepper: PEPPER,
  plan: 'FREE',
};

function keysOf(check: { dimensions: readonly { key: string }[] }): string[] {
  return check.dimensions.map((dimension) => dimension.key);
}

describe('key construction (13_Security_Privacy_Compliance.md)', () => {
  it('refuses to key on a raw IPv4 or IPv6 address', () => {
    expect(() => rateLimitKey('public.ip_prefix', '203.0.113.42')).toThrow(RateLimitKeyError);
    expect(() => rateLimitKey('public.ip_prefix', '2001:db8::1')).toThrow(RateLimitKeyError);
  });

  it('refuses a component that could impersonate another key', () => {
    expect(() => rateLimitKey('public.session_hourly', 'abcd:public.ip_prefix')).toThrow(
      RateLimitKeyError,
    );
    expect(() => rateLimitKey('public.session_hourly', '')).toThrow(RateLimitKeyError);
  });

  it('recognises addresses without rejecting hashes or identifiers', () => {
    expect(looksLikeIpAddress('192.168.1.1')).toBe(true);
    expect(looksLikeIpAddress('::1')).toBe(true);
    expect(looksLikeIpAddress(ipPrefixHash('192.168.1.1', PEPPER))).toBe(false);
    expect(looksLikeIpAddress('4f3c9a1e-0000-4000-8000-000000000001')).toBe(false);
    expect(looksLikeIpAddress('anon-session-abc')).toBe(false);
  });

  it('never puts the raw IP or session identifier into a public key', () => {
    const keys = keysOf(publicGenerationCheck({ ...subject, plan: 'PRO' }, 1)).concat(
      ipSessionSetKey(subject),
    );

    for (const key of keys) {
      expect(key).not.toContain('203.0.113');
      expect(key).not.toContain('anon-session-abc');
      expect(key.startsWith('rl:v1:')).toBe(true);
    }
  });

  it('never puts the raw login identifier into an auth key', () => {
    const keys = keysOf(
      loginFailureCheck({ identifier: 'owner@example.com', ip: '203.0.113.42', pepper: PEPPER }),
    );

    for (const key of keys) {
      expect(key).not.toContain('owner@example.com');
      expect(key).not.toContain('203.0.113');
    }
  });

  it('keys the same subject identically across calls', () => {
    expect(keysOf(publicGenerationCheck(subject, 1))).toEqual(
      keysOf(publicGenerationCheck(subject, 1)),
    );
  });

  /** AC-002 is bypassed if retyping the address in another case opens a fresh window. */
  it('normalises the login identifier before hashing', () => {
    expect(loginIdentityHash('  Owner@Example.COM ', PEPPER)).toBe(
      loginIdentityHash('owner@example.com', PEPPER),
    );
    expect(loginIdentityHash('owner@example.com', PEPPER)).not.toBe(
      loginIdentityHash('other@example.com', PEPPER),
    );
  });
});

describe('IP prefix keying', () => {
  it('groups addresses in the same /24 and separates different networks', () => {
    const sameNetwork = ipSessionSetKey({ ...subject, ip: '203.0.113.200' });
    const otherNetwork = ipSessionSetKey({ ...subject, ip: '198.51.100.7' });

    expect(ipSessionSetKey(subject)).toBe(sameNetwork);
    expect(ipSessionSetKey(subject)).not.toBe(otherNetwork);
  });

  it('separates the same prefix under a different pepper', () => {
    expect(ipSessionSetKey(subject)).not.toBe(ipSessionSetKey({ ...subject, pepper: 'other' }));
  });
});

describe('adaptive IP-prefix limit', () => {
  const config: RateLimitConfig = {
    ...DEFAULT_RATE_LIMIT_CONFIG,
    ipPrefixBaseLimit: 20,
    ipPrefixPerSessionLimit: 8,
    ipPrefixCeiling: 240,
  };

  it('gives a single-session prefix the base allowance', () => {
    expect(adaptiveIpPrefixLimit(1, config)).toBe(20);
  });

  /** An empty or unavailable distinct count must not widen the allowance. */
  it('never drops below the base allowance', () => {
    expect(adaptiveIpPrefixLimit(0, config)).toBe(20);
    expect(adaptiveIpPrefixLimit(-5, config)).toBe(20);
  });

  it('widens as distinct sessions share the prefix', () => {
    expect(adaptiveIpPrefixLimit(2, config)).toBe(28);
    expect(adaptiveIpPrefixLimit(10, config)).toBe(92);
  });

  /**
   * The ceiling is the real bound: session identifiers are client-supplied, so an attacker can
   * always manufacture distinct sessions and climb. The clamp is what stops that being
   * unbounded.
   */
  it('clamps at the ceiling however many sessions appear', () => {
    expect(adaptiveIpPrefixLimit(1_000, config)).toBe(240);
    expect(adaptiveIpPrefixLimit(1_000_000, config)).toBe(240);
  });

  /** Growth per fabricated session must stay under the per-session cap, or forging pays. */
  it('grows more slowly than a real session is allowed to generate', () => {
    expect(config.ipPrefixPerSessionLimit).toBeLessThan(config.sessionGenerationsPerHour);
  });
});

describe('composed public check', () => {
  it('measures burst, per-business session use, and network prefix together (AC-032)', () => {
    const dimensions = publicGenerationCheck({ ...subject, plan: 'PRO' }, 3).dimensions;

    expect(dimensions.map((dimension) => dimension.rule.name)).toEqual([
      'public.session_burst',
      'public.session_hourly',
      'public.ip_prefix',
      'public.business_fair_use',
    ]);
    expect(dimensions.map((dimension) => dimension.rule.code)).toEqual([
      'PUBLIC_RATE_LIMITED',
      'PUBLIC_RATE_LIMITED',
      'PUBLIC_RATE_LIMITED',
      'FAIR_USE_THROTTLED',
    ]);
  });

  it('scopes the hourly window to one business but shares the burst window', () => {
    const first = publicGenerationCheck(subject, 1).dimensions;
    const second = publicGenerationCheck({ ...subject, businessId: 'business-2' }, 1).dimensions;

    expect(first[0]?.key).toBe(second[0]?.key);
    expect(first[1]?.key).not.toBe(second[1]?.key);
  });

  it('holds the spec limit of ten session generations an hour', () => {
    const hourly = publicGenerationCheck(subject, 1).dimensions[1];

    expect(hourly?.rule.limit).toBe(10);
    expect(hourly?.rule.windowMs).toBe(60 * 60 * 1000);
  });
});

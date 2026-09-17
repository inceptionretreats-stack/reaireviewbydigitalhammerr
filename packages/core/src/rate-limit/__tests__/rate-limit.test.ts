import { describe, expect, it, vi } from 'vitest';
import { MemoryRateLimitStore } from '../memory-store';
import {
  DEFAULT_RATE_LIMIT_CONFIG,
  loginFailureCheck,
  publicGenerationCheck,
  type RateLimitConfig,
} from '../policies';
import { DEGRADED_RETRY_AFTER_SECONDS, RateLimiter, rateLimitHeaders } from '../service';
import type { RateLimitCheck, RateLimitDimension, RateLimitRule, RateLimitStore } from '../types';

const PEPPER = 'test-pepper';
const START = 1_764_000_000_000;

function clock(start = START) {
  let current = start;
  return {
    now: () => current,
    advance(ms: number) {
      current += ms;
    },
  };
}

function rule(over: Partial<RateLimitRule> = {}): RateLimitRule {
  return {
    name: 'test.dimension',
    limit: 3,
    windowMs: 60_000,
    code: 'PUBLIC_RATE_LIMITED',
    enforcement: 'ENFORCE',
    ...over,
  };
}

function check(
  dimensions: RateLimitDimension[],
  over: Partial<RateLimitCheck> = {},
): RateLimitCheck {
  return { name: 'test_check', dimensions, onStoreUnavailable: 'ALLOW', ...over };
}

function single(over: Partial<RateLimitRule> = {}): { check: RateLimitCheck; key: string } {
  const built = rule(over);
  const key = `rl:v1:${built.name}:subject`;
  return { check: check([{ rule: built, key }]), key };
}

/** A store that is always unreachable, standing in for a Redis outage. */
const brokenStore: RateLimitStore = {
  consume: () => Promise.reject(new Error('ECONNREFUSED')),
  inspect: () => Promise.reject(new Error('ECONNREFUSED')),
  forget: () => Promise.reject(new Error('ECONNREFUSED')),
  countDistinct: () => Promise.reject(new Error('ECONNREFUSED')),
};

describe('sliding window', () => {
  it('admits exactly the limit and denies the next call', async () => {
    const time = clock();
    const limiter = new RateLimiter(new MemoryRateLimitStore(), { now: time.now });
    const { check: subject } = single({ limit: 3 });

    const admitted = [
      await limiter.consume(subject),
      await limiter.consume(subject),
      await limiter.consume(subject),
    ];
    const refused = await limiter.consume(subject);

    expect(admitted.every((decision) => decision.allowed)).toBe(true);
    expect(admitted[2]?.windows[0]?.remaining).toBe(0);
    expect(refused).toMatchObject({ allowed: false, code: 'PUBLIC_RATE_LIMITED' });
  });

  /**
   * The window boundary, asserted from both sides. One millisecond before the first hit ages
   * out the caller is still refused; at the exact boundary one slot — and only one — frees.
   */
  it('frees exactly one slot as the window slides', async () => {
    const time = clock();
    const store = new MemoryRateLimitStore();
    const limiter = new RateLimiter(store, { now: time.now });
    const { check: subject, key } = single({ limit: 3, windowMs: 60_000 });

    await limiter.consume(subject); // t0
    time.advance(10_000);
    await limiter.consume(subject); // t0 + 10s
    time.advance(10_000);
    await limiter.consume(subject); // t0 + 20s
    expect((await limiter.consume(subject)).allowed).toBe(false);

    time.advance(40_000 - 1); // t0 + 60s - 1ms: the first hit is still inside the window
    expect((await limiter.consume(subject)).allowed).toBe(false);

    time.advance(1); // t0 + 60s exactly
    expect((await limiter.consume(subject)).allowed).toBe(true);
    expect((await limiter.consume(subject)).allowed).toBe(false);
    expect(store.count(key, 60_000, time.now())).toBe(3);
  });

  it('reports a retry-after that tracks the oldest hit', async () => {
    const time = clock();
    const limiter = new RateLimiter(new MemoryRateLimitStore(), { now: time.now });
    const { check: subject } = single({ limit: 1, windowMs: 60_000 });

    await limiter.consume(subject);
    const immediately = await limiter.consume(subject);
    time.advance(45_000);
    const later = await limiter.consume(subject);

    expect(immediately).toMatchObject({ allowed: false, retryAfterSeconds: 60 });
    expect(later).toMatchObject({ allowed: false, retryAfterSeconds: 15 });
  });

  /** Retry-After: 0 means "retry now", so a sub-second wait must still round up. */
  it('never reports a retry-after of zero', async () => {
    const time = clock();
    const limiter = new RateLimiter(new MemoryRateLimitStore(), { now: time.now });
    const { check: subject } = single({ limit: 1, windowMs: 1_000 });

    await limiter.consume(subject);
    time.advance(999);
    const decision = await limiter.consume(subject);

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.retryAfterSeconds).toBe(1);
  });

  /**
   * A refused call must not be recorded. If it were, a bot loop would keep pushing its own
   * window forward and the limit would become a permanent ban rather than a rate.
   */
  it('does not record refused calls', async () => {
    const time = clock();
    const store = new MemoryRateLimitStore();
    const limiter = new RateLimiter(store, { now: time.now });
    const { check: subject, key } = single({ limit: 2, windowMs: 60_000 });

    await limiter.consume(subject);
    await limiter.consume(subject);
    for (let attempt = 0; attempt < 50; attempt += 1) {
      await limiter.consume(subject);
    }

    expect(store.count(key, 60_000, time.now())).toBe(2);

    time.advance(60_000);
    expect((await limiter.consume(subject)).allowed).toBe(true);
    expect((await limiter.consume(subject)).allowed).toBe(true);
  });

  it('inspects without recording', async () => {
    const time = clock();
    const store = new MemoryRateLimitStore();
    const limiter = new RateLimiter(store, { now: time.now });
    const { check: subject, key } = single({ limit: 1 });

    const first = await limiter.inspect(subject);
    const second = await limiter.inspect(subject);

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    expect(store.count(key, 60_000, time.now())).toBe(0);
  });
});

describe('composed dimensions (AC-032)', () => {
  const burst = rule({ name: 'public.session_burst', limit: 2, windowMs: 20_000 });
  const hourly = rule({ name: 'public.session_hourly', limit: 10, windowMs: 3_600_000 });

  function composed(): RateLimitCheck {
    return check([
      { rule: burst, key: 'rl:v1:burst:s' },
      { rule: hourly, key: 'rl:v1:hourly:s' },
    ]);
  }

  it('names the dimension that tripped', async () => {
    const limiter = new RateLimiter(new MemoryRateLimitStore(), { now: clock().now });
    const subject = composed();

    await limiter.consume(subject);
    await limiter.consume(subject);
    const decision = await limiter.consume(subject);

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.dimension).toBe('public.session_burst');
      expect(decision.retryAfterSeconds).toBe(20);
    }
  });

  /**
   * Check-all-then-commit. When the burst dimension refuses, the hourly dimension must not
   * have spent a slot — otherwise an attacker who deliberately saturates the cheap dimension
   * drains every window paired with it.
   */
  it('records nothing on any dimension when one of them refuses', async () => {
    const time = clock();
    const store = new MemoryRateLimitStore();
    const limiter = new RateLimiter(store, { now: time.now });
    const subject = composed();

    await limiter.consume(subject);
    await limiter.consume(subject);
    await limiter.consume(subject); // refused by burst
    await limiter.consume(subject); // refused by burst

    expect(store.count('rl:v1:hourly:s', 3_600_000, time.now())).toBe(2);

    // Once the burst window clears, the hourly allowance is intact rather than drained.
    time.advance(20_000);
    expect((await limiter.consume(subject)).allowed).toBe(true);
  });

  it('reports every window so the caller can size its headers', async () => {
    const limiter = new RateLimiter(new MemoryRateLimitStore(), { now: clock().now });
    const decision = await limiter.consume(composed());

    expect(decision.windows.map((window) => window.dimension)).toEqual([
      'public.session_burst',
      'public.session_hourly',
    ]);
    expect(decision.windows.map((window) => window.remaining)).toEqual([1, 9]);
  });
});

describe('paid hourly abuse threshold is observed, not enforced', () => {
  const enforced = rule({ name: 'public.session_hourly', limit: 10 });
  const soft = rule({
    name: 'public.business_fair_use',
    limit: 2,
    code: 'FAIR_USE_THROTTLED',
    enforcement: 'OBSERVE',
  });

  const subject = check([
    { rule: enforced, key: 'rl:v1:hourly:s' },
    { rule: soft, key: 'rl:v1:fairuse:b' },
  ]);

  it('never denies on a soft threshold but does report it', async () => {
    const limiter = new RateLimiter(new MemoryRateLimitStore(), { now: clock().now });

    await limiter.consume(subject);
    await limiter.consume(subject);
    const decision = await limiter.consume(subject);

    expect(decision.allowed).toBe(true);
    expect(decision.softExceeded.map((window) => window.dimension)).toEqual([
      'public.business_fair_use',
    ]);
  });

  /** The observation window is not the advertised annual allowance and must not pose as one. */
  it('keeps the soft dimension out of the response headers', async () => {
    const limiter = new RateLimiter(new MemoryRateLimitStore(), { now: clock().now });

    await limiter.consume(subject);
    await limiter.consume(subject);
    const headers = rateLimitHeaders(await limiter.consume(subject));

    expect(headers['X-RateLimit-Limit']).toBe('10');
    expect(headers['X-RateLimit-Remaining']).toBe('7');
    expect(headers['Retry-After']).toBeUndefined();
  });

  it('emits Retry-After only on a denial', async () => {
    const limiter = new RateLimiter(new MemoryRateLimitStore(), { now: clock().now });
    const { check: tight } = single({ limit: 1, windowMs: 30_000 });

    await limiter.consume(tight);
    const headers = rateLimitHeaders(await limiter.consume(tight));

    expect(headers['Retry-After']).toBe('30');
  });
});

describe('concurrency', () => {
  it('admits exactly the limit out of a simultaneous burst', async () => {
    const limiter = new RateLimiter(new MemoryRateLimitStore(), { now: clock().now });
    const { check: subject } = single({ limit: 5 });

    const decisions = await Promise.all(Array.from({ length: 40 }, () => limiter.consume(subject)));

    expect(decisions.filter((decision) => decision.allowed)).toHaveLength(5);
  });

  /**
   * Proves the test above has teeth. Against a store that reads, yields, then writes, every
   * caller decides there is room before any of them writes and the limit is meaningless. If
   * this ever stops failing the atomicity guarantee has stopped mattering.
   */
  it('detects a read-then-write store', async () => {
    const limiter = new RateLimiter(new MemoryRateLimitStore(true), { now: clock().now });
    const { check: subject } = single({ limit: 5 });

    const decisions = await Promise.all(Array.from({ length: 40 }, () => limiter.consume(subject)));

    expect(decisions.filter((decision) => decision.allowed).length).toBeGreaterThan(5);
  });
});

describe('store unavailable', () => {
  it('fails open for public generation, and says so (AC-035)', async () => {
    const onStoreUnavailable = vi.fn();
    const limiter = new RateLimiter(brokenStore, { now: clock().now, onStoreUnavailable });

    const decision = await limiter.publicGeneration({
      businessId: 'business-1',
      anonymousSessionId: 'session-1',
      ip: '203.0.113.10',
      pepper: PEPPER,
      plan: 'FREE',
    });

    expect(decision).toMatchObject({ allowed: true, degraded: true });
    expect(onStoreUnavailable).toHaveBeenCalled();
  });

  it('fails closed for login, with a retry-after (AC-002)', async () => {
    const limiter = new RateLimiter(brokenStore, { now: clock().now });

    const decision = await limiter.loginAttempt({
      identifier: 'owner@example.com',
      ip: '203.0.113.10',
      pepper: PEPPER,
    });

    expect(decision).toMatchObject({
      allowed: false,
      code: 'AUTH_RATE_LIMITED',
      degraded: true,
      retryAfterSeconds: DEGRADED_RETRY_AFTER_SECONDS,
    });
  });

  /**
   * The preferred degradation: a per-container store still limits while Redis is unreachable,
   * so neither AC-032 nor AC-035 has to be given up entirely.
   */
  it('keeps limiting from the fallback store', async () => {
    const time = clock();
    const limiter = new RateLimiter(brokenStore, {
      now: time.now,
      fallbackStore: new MemoryRateLimitStore(),
    });
    const { check: subject } = single({ limit: 2 });

    const first = await limiter.consume(subject);
    await limiter.consume(subject);
    const third = await limiter.consume(subject);

    expect(first).toMatchObject({ allowed: true, degraded: true });
    expect(third).toMatchObject({ allowed: false, degraded: true });
  });

  it('never lets the alerting hook fail a request', async () => {
    const limiter = new RateLimiter(brokenStore, {
      now: clock().now,
      onStoreUnavailable: () => {
        throw new Error('pager is down too');
      },
    });

    await expect(limiter.consume(single().check)).resolves.toMatchObject({ allowed: true });
  });

  it('forgives without throwing when the store is unreachable', async () => {
    const limiter = new RateLimiter(brokenStore, { now: clock().now });
    await expect(
      limiter.loginSuccess({ identifier: 'owner@example.com', ip: '203.0.113.10', pepper: PEPPER }),
    ).resolves.toBeUndefined();
  });
});

describe('login failures (AC-002 / AUTH-02-02)', () => {
  const subject = { identifier: 'owner@example.com', ip: '203.0.113.10', pepper: PEPPER };

  it('locks the identity after the configured number of failures', async () => {
    const time = clock();
    const limiter = new RateLimiter(new MemoryRateLimitStore(), { now: time.now });

    for (
      let attempt = 0;
      attempt < DEFAULT_RATE_LIMIT_CONFIG.loginFailuresPerIdentity;
      attempt += 1
    ) {
      expect((await limiter.loginFailure(subject)).allowed).toBe(true);
    }

    const blocked = await limiter.loginAttempt(subject);
    expect(blocked).toMatchObject({
      allowed: false,
      code: 'AUTH_RATE_LIMITED',
      dimension: 'auth.login_identity',
    });
    if (!blocked.allowed) expect(blocked.retryAfterSeconds).toBe(15 * 60);
  });

  it('forgives earlier failures once the password is right', async () => {
    const limiter = new RateLimiter(new MemoryRateLimitStore(), { now: clock().now });

    for (let attempt = 0; attempt < 4; attempt += 1) await limiter.loginFailure(subject);
    await limiter.loginSuccess(subject);

    expect((await limiter.loginAttempt(subject)).allowed).toBe(true);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await limiter.loginFailure(subject)).allowed).toBe(true);
    }
  });

  /**
   * A success must not hand the attacker a reset button for the spray limit: an attacker
   * spraying from one network usually holds one working account of their own.
   */
  it('does not let a success forgive the IP-prefix window', async () => {
    const config: RateLimitConfig = {
      ...DEFAULT_RATE_LIMIT_CONFIG,
      loginFailuresPerIdentity: 50,
      loginFailuresPerIdentityPerDay: 50,
      mfaFailuresPerSession: 5,
      mfaSessionWindowMs: 15 * 60 * 1000,
      mfaFailuresPerIpPrefix: 25,
      mfaIpPrefixWindowMs: 15 * 60 * 1000,
      mfaFailuresPerUserPerDay: 30,
      loginFailuresPerIpPrefix: 3,
    };
    const limiter = new RateLimiter(new MemoryRateLimitStore(), { now: clock().now, config });

    for (let account = 0; account < 3; account += 1) {
      await limiter.loginFailure({ ...subject, identifier: `user${account}@x.com` });
    }
    await limiter.loginSuccess({ ...subject, identifier: 'attacker@x.com' });

    const decision = await limiter.loginAttempt({ ...subject, identifier: 'user9@x.com' });
    expect(decision).toMatchObject({ allowed: false, dimension: 'auth.login_ip_prefix' });
  });

  /** Password spraying: one guess each against many accounts from one network. */
  it('limits by IP prefix across different identities', async () => {
    const config: RateLimitConfig = {
      ...DEFAULT_RATE_LIMIT_CONFIG,
      loginFailuresPerIdentity: 50,
      loginFailuresPerIdentityPerDay: 50,
      mfaFailuresPerSession: 5,
      mfaSessionWindowMs: 15 * 60 * 1000,
      mfaFailuresPerIpPrefix: 25,
      mfaIpPrefixWindowMs: 15 * 60 * 1000,
      mfaFailuresPerUserPerDay: 30,
      loginFailuresPerIpPrefix: 3,
    };
    const limiter = new RateLimiter(new MemoryRateLimitStore(), { now: clock().now, config });

    for (let account = 0; account < 3; account += 1) {
      const decision = await limiter.loginFailure({
        ...subject,
        identifier: `user${account}@x.com`,
      });
      expect(decision.allowed).toBe(true);
    }

    const decision = await limiter.loginFailure({ ...subject, identifier: 'user9@x.com' });
    expect(decision).toMatchObject({ allowed: false, dimension: 'auth.login_ip_prefix' });
  });

  it('treats a differently-cased address as the same identity', async () => {
    const limiter = new RateLimiter(new MemoryRateLimitStore(), { now: clock().now });

    for (let attempt = 0; attempt < 5; attempt += 1) await limiter.loginFailure(subject);

    const disguised = await limiter.loginAttempt({
      ...subject,
      identifier: '  Owner@Example.COM ',
    });
    expect(disguised.allowed).toBe(false);
  });

  it('does not count failures against an unrelated account', async () => {
    const limiter = new RateLimiter(new MemoryRateLimitStore(), { now: clock().now });

    for (let attempt = 0; attempt < 5; attempt += 1) await limiter.loginFailure(subject);

    const other = await limiter.loginAttempt({
      identifier: 'someone-else@example.com',
      ip: '198.51.100.7',
      pepper: PEPPER,
    });
    expect(other.allowed).toBe(true);
  });
});

describe('public generation (09 abuse controls)', () => {
  const subject = {
    businessId: 'business-1',
    anonymousSessionId: 'session-1',
    ip: '203.0.113.10',
    pepper: PEPPER,
    plan: 'FREE' as const,
  };

  const loose: RateLimitConfig = {
    ...DEFAULT_RATE_LIMIT_CONFIG,
    sessionBurstLimit: 1000,
    ipPrefixBaseLimit: 1000,
    ipPrefixCeiling: 1000,
  };

  it('caps an anonymous session at ten generations an hour for one business', async () => {
    const time = clock();
    const limiter = new RateLimiter(new MemoryRateLimitStore(), { now: time.now, config: loose });

    for (let generation = 0; generation < 10; generation += 1) {
      expect((await limiter.publicGeneration(subject)).allowed).toBe(true);
      time.advance(30_000);
    }

    const eleventh = await limiter.publicGeneration(subject);
    expect(eleventh).toMatchObject({
      allowed: false,
      code: 'PUBLIC_RATE_LIMITED',
      dimension: 'public.session_hourly',
    });
  });

  it('counts the hourly allowance per business, not globally', async () => {
    const time = clock();
    const limiter = new RateLimiter(new MemoryRateLimitStore(), { now: time.now, config: loose });

    for (let generation = 0; generation < 10; generation += 1) {
      await limiter.publicGeneration(subject);
      time.advance(30_000);
    }

    expect((await limiter.publicGeneration(subject)).allowed).toBe(false);
    const otherBusiness = await limiter.publicGeneration({ ...subject, businessId: 'business-2' });
    expect(otherBusiness.allowed).toBe(true);
  });

  /** AC-032, "resists simple bot loops": no think-time between calls. */
  it('stops a tight loop on the burst dimension before the hourly one', async () => {
    const limiter = new RateLimiter(new MemoryRateLimitStore(), { now: clock().now });

    const decisions = [
      await limiter.publicGeneration(subject),
      await limiter.publicGeneration(subject),
      await limiter.publicGeneration(subject),
      await limiter.publicGeneration(subject),
    ];

    expect(decisions.slice(0, 3).every((decision) => decision.allowed)).toBe(true);
    expect(decisions[3]).toMatchObject({
      allowed: false,
      dimension: 'public.session_burst',
      code: 'PUBLIC_RATE_LIMITED',
    });
  });

  it('shares the IP-prefix window across addresses in the same /24', async () => {
    const time = clock();
    const config: RateLimitConfig = {
      ...DEFAULT_RATE_LIMIT_CONFIG,
      ipPrefixBaseLimit: 2,
      ipPrefixPerSessionLimit: 0,
      ipPrefixCeiling: 2,
    };
    const limiter = new RateLimiter(new MemoryRateLimitStore(), { now: time.now, config });

    await limiter.publicGeneration({ ...subject, ip: '203.0.113.10' });
    time.advance(30_000);
    await limiter.publicGeneration({ ...subject, ip: '203.0.113.200' });
    time.advance(30_000);

    const third = await limiter.publicGeneration({ ...subject, ip: '203.0.113.99' });
    expect(third).toMatchObject({ allowed: false, dimension: 'public.ip_prefix' });
  });

  /**
   * The adaptive part: a second session sharing the prefix raises the prefix allowance, which
   * is what keeps a café's shared wifi from behaving like one abusive client.
   */
  it('widens the IP-prefix allowance as distinct sessions appear', async () => {
    const time = clock();
    const config: RateLimitConfig = {
      ...DEFAULT_RATE_LIMIT_CONFIG,
      sessionBurstLimit: 100,
      ipPrefixBaseLimit: 2,
      ipPrefixPerSessionLimit: 1,
      ipPrefixCeiling: 3,
    };
    const limiter = new RateLimiter(new MemoryRateLimitStore(), { now: time.now, config });

    expect((await limiter.publicGeneration(subject)).allowed).toBe(true);
    expect((await limiter.publicGeneration(subject)).allowed).toBe(true);
    expect((await limiter.publicGeneration(subject)).allowed).toBe(false);

    // A second customer on the same wifi: the prefix allowance grows to 3, so their first
    // generation is admitted rather than paying for the first session's traffic.
    const second = { ...subject, anonymousSessionId: 'session-2' };
    expect((await limiter.publicGeneration(second)).allowed).toBe(true);

    // ...and the ceiling still binds: a third session cannot lift it past 3.
    const third = { ...subject, anonymousSessionId: 'session-3' };
    expect((await limiter.publicGeneration(third)).allowed).toBe(false);
  });

  it('adds the paid abuse observation only for a paid business', async () => {
    const free = publicGenerationCheck({ ...subject, plan: 'FREE' }, 1);
    const pro = publicGenerationCheck({ ...subject, plan: 'PRO' }, 1);

    expect(free.dimensions.map((dimension) => dimension.rule.name)).not.toContain(
      'public.business_fair_use',
    );
    expect(pro.dimensions.map((dimension) => dimension.rule.name)).toContain(
      'public.business_fair_use',
    );
  });

  it('fails open rather than blocking the flow, and closed for login', () => {
    expect(publicGenerationCheck(subject, 1).onStoreUnavailable).toBe('ALLOW');
    expect(
      loginFailureCheck({ identifier: 'a@b.com', ip: '203.0.113.10', pepper: PEPPER })
        .onStoreUnavailable,
    ).toBe('DENY');
  });
});

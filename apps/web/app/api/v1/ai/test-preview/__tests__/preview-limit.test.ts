import { describe, expect, it } from 'vitest';
import {
  MemoryRateLimitStore,
  RateLimiter,
  type RateLimitReading,
  type RateLimitStore,
  type ResolvedTenant,
} from '@ai-review/core';
import {
  PREVIEW_BURST_LIMIT,
  PREVIEW_BURST_WINDOW_MS,
  PREVIEW_HOURLY_LIMIT,
  PREVIEW_HOURLY_WINDOW_MS,
  previewCheck,
} from '../preview-limit';

/**
 * The preview endpoint deliberately does not consult QuotaService (ONB-04-02), so this check is
 * the *only* bound on paid provider calls made from the dashboard. These tests pin the three
 * properties that matter if it is ever edited: it denies, it denies per tenant, and it denies
 * rather than admits when the store is gone.
 */

/**
 * `previewCheck` demands a `ResolvedTenant` so a business id from a request body cannot key a
 * window (RBAC rule 2). A test has no TenantGuard, so the brand is applied here — the one place the
 * cast is honest, because the value is not standing in for a checked id in production code.
 */
const BUSINESS = '11111111-1111-4111-8111-111111111111' as ResolvedTenant;
const OTHER_BUSINESS = '22222222-2222-4222-8222-222222222222' as ResolvedTenant;

function limiterAt(startMs: number, store: RateLimitStore = new MemoryRateLimitStore()) {
  let now = startMs;
  const limiter = new RateLimiter(store, { now: () => now });
  return { limiter, advance: (ms: number) => (now += ms) };
}

/** A store that is unreachable in every operation, i.e. Redis is down and no fallback is wired. */
class BrokenStore implements RateLimitStore {
  consume(): Promise<RateLimitReading> {
    return Promise.reject(new Error('store unavailable'));
  }
  inspect(): Promise<RateLimitReading> {
    return Promise.reject(new Error('store unavailable'));
  }
  forget(): Promise<void> {
    return Promise.reject(new Error('store unavailable'));
  }
  countDistinct(): Promise<number> {
    return Promise.reject(new Error('store unavailable'));
  }
}

describe('AI preview rate limiting', () => {
  it('admits previews up to the burst limit', async () => {
    const { limiter } = limiterAt(1_000_000);

    for (let i = 0; i < PREVIEW_BURST_LIMIT; i += 1) {
      const decision = await limiter.consume(previewCheck(BUSINESS));
      expect(decision.allowed).toBe(true);
    }
  });

  it('denies the next preview, names the burst dimension and gives a Retry-After', async () => {
    const { limiter } = limiterAt(1_000_000);

    for (let i = 0; i < PREVIEW_BURST_LIMIT; i += 1) {
      await limiter.consume(previewCheck(BUSINESS));
    }

    const denied = await limiter.consume(previewCheck(BUSINESS));
    expect(denied.allowed).toBe(false);
    if (!denied.allowed) {
      // AC-032: the endpoint can only say "wait a moment" honestly if the decision says which
      // window refused and when a slot frees.
      expect(denied.dimension).toBe('ai.preview_burst');
      expect(denied.code).toBe('FAIR_USE_THROTTLED');
      expect(denied.retryAfterSeconds).toBeGreaterThanOrEqual(1);
      expect(denied.retryAfterSeconds).toBeLessThanOrEqual(PREVIEW_BURST_WINDOW_MS / 1000);
    }
  });

  it('lets the burst window slide, so an owner is not locked out for an hour', async () => {
    const { limiter, advance } = limiterAt(1_000_000);

    for (let i = 0; i < PREVIEW_BURST_LIMIT; i += 1) {
      await limiter.consume(previewCheck(BUSINESS));
    }
    expect((await limiter.consume(previewCheck(BUSINESS))).allowed).toBe(false);

    advance(PREVIEW_BURST_WINDOW_MS + 1);
    expect((await limiter.consume(previewCheck(BUSINESS))).allowed).toBe(true);
  });

  /**
   * The bound that actually caps spend: a caller pacing itself around the burst window still
   * cannot exceed the hourly allowance, because a preview counts against no quota (ONB-04-02).
   */
  it('caps a paced loop at the hourly limit', async () => {
    const { limiter, advance } = limiterAt(1_000_000);
    let allowed = 0;

    for (let i = 0; i < PREVIEW_HOURLY_LIMIT + 10; i += 1) {
      const decision = await limiter.consume(previewCheck(BUSINESS));
      if (decision.allowed) allowed += 1;
      advance(PREVIEW_BURST_WINDOW_MS + 1);
    }

    expect(allowed).toBe(PREVIEW_HOURLY_LIMIT);
  });

  it('releases the hourly allowance as the window slides', async () => {
    const { limiter, advance } = limiterAt(1_000_000);

    for (let i = 0; i < PREVIEW_HOURLY_LIMIT; i += 1) {
      await limiter.consume(previewCheck(BUSINESS));
      advance(PREVIEW_BURST_WINDOW_MS + 1);
    }
    const denied = await limiter.consume(previewCheck(BUSINESS));
    expect(denied.allowed).toBe(false);
    if (!denied.allowed) expect(denied.dimension).toBe('ai.preview_hourly');

    advance(PREVIEW_HOURLY_WINDOW_MS + 1);
    expect((await limiter.consume(previewCheck(BUSINESS))).allowed).toBe(true);
  });

  /** AC-003 in the limiter: one tenant exhausting its previews must not affect another's. */
  it('scopes every dimension to the resolved tenant', async () => {
    const { limiter } = limiterAt(1_000_000);

    for (let i = 0; i < PREVIEW_BURST_LIMIT + 1; i += 1) {
      await limiter.consume(previewCheck(BUSINESS));
    }

    expect((await limiter.consume(previewCheck(OTHER_BUSINESS))).allowed).toBe(true);

    for (const dimension of previewCheck(BUSINESS).dimensions) {
      expect(dimension.key).toContain(BUSINESS);
      expect(dimension.key).not.toContain(OTHER_BUSINESS);
    }
  });

  /**
   * Fails closed, unlike the public generation check. There is no quota counter behind this
   * endpoint to bound spend during a Redis outage, and AC-035 protects the customer flow, which
   * this endpoint is not on. Onboarding is unaffected either way: an AI failure never blocks
   * Continue (AC-036).
   */
  it('denies rather than admits when the store is unreachable', async () => {
    const { limiter } = limiterAt(1_000_000, new BrokenStore());

    const decision = await limiter.consume(previewCheck(BUSINESS));
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.degraded).toBe(true);
      expect(decision.dimension).toBe('ai_preview.store_unavailable');
      expect(decision.code).toBe('FAIR_USE_THROTTLED');
    }
  });

  /** A per-process fallback still limits, so an outage degrades rather than opening the door. */
  it('limits through the fallback store when the primary throws', async () => {
    let now = 1_000_000;
    const limiter = new RateLimiter(new BrokenStore(), {
      now: () => now,
      fallbackStore: new MemoryRateLimitStore(),
    });

    for (let i = 0; i < PREVIEW_BURST_LIMIT; i += 1) {
      const decision = await limiter.consume(previewCheck(BUSINESS));
      expect(decision.allowed).toBe(true);
      expect(decision.degraded).toBe(true);
    }

    expect((await limiter.consume(previewCheck(BUSINESS))).allowed).toBe(false);
    now += PREVIEW_BURST_WINDOW_MS + 1;
    expect((await limiter.consume(previewCheck(BUSINESS))).allowed).toBe(true);
  });
});

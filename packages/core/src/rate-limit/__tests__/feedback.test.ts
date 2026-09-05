import { describe, expect, it } from 'vitest';
import { MemoryRateLimitStore } from '../memory-store';
import { DEFAULT_RATE_LIMIT_CONFIG, publicFeedbackCheck } from '../policies';
import { RateLimiter } from '../service';

const SUBJECT = {
  businessId: 'biz-1',
  anonymousSessionId: 'sess-1',
  ip: '203.0.113.42',
  pepper: 'test-pepper-value',
};

function limiterAt(startMs: number) {
  let now = startMs;
  const limiter = new RateLimiter(new MemoryRateLimitStore(), { now: () => now });
  return { limiter, advance: (ms: number) => (now += ms) };
}

describe('private feedback rate limiting', () => {
  it('admits submissions up to the per-session limit', async () => {
    const { limiter } = limiterAt(1_000_000);
    const cap = DEFAULT_RATE_LIMIT_CONFIG.feedbackPerSession;

    for (let i = 0; i < cap; i += 1) {
      const decision = await limiter.publicFeedback(SUBJECT);
      expect(decision.allowed).toBe(true);
    }
  });

  it('denies the next submission and names the dimension that tripped', async () => {
    const { limiter } = limiterAt(1_000_000);

    for (let i = 0; i < DEFAULT_RATE_LIMIT_CONFIG.feedbackPerSession; i += 1) {
      await limiter.publicFeedback(SUBJECT);
    }

    const denied = await limiter.publicFeedback(SUBJECT);
    expect(denied.allowed).toBe(false);
    if (!denied.allowed) {
      // AC-032: the caller needs to know which dimension refused, to say something useful.
      expect(denied.dimension).toBe('public.feedback_session');
      expect(denied.code).toBe('PUBLIC_RATE_LIMITED');
      expect(denied.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    }
  });

  it('lets the window slide rather than resetting on a fixed boundary', async () => {
    const { limiter, advance } = limiterAt(1_000_000);

    for (let i = 0; i < DEFAULT_RATE_LIMIT_CONFIG.feedbackPerSession; i += 1) {
      await limiter.publicFeedback(SUBJECT);
    }
    expect((await limiter.publicFeedback(SUBJECT)).allowed).toBe(false);

    advance(DEFAULT_RATE_LIMIT_CONFIG.feedbackSessionWindowMs + 1);
    expect((await limiter.publicFeedback(SUBJECT)).allowed).toBe(true);
  });

  /**
   * The session dimension is keyed per business, so filling one business's allowance must not
   * silence a visitor who then goes to a different business's page. D-010 makes private
   * feedback available to every visitor.
   */
  it('scopes the session limit per business', async () => {
    const { limiter } = limiterAt(1_000_000);

    for (let i = 0; i < DEFAULT_RATE_LIMIT_CONFIG.feedbackPerSession; i += 1) {
      await limiter.publicFeedback(SUBJECT);
    }

    const other = await limiter.publicFeedback({ ...SUBJECT, businessId: 'biz-2' });
    expect(other.allowed).toBe(true);
  });

  /**
   * A client discarding its cookie gets a fresh session, so the prefix dimension is the one
   * that actually bounds that case.
   */
  it('still bounds a client that rotates its session identifier', async () => {
    const { limiter } = limiterAt(1_000_000);
    let allowed = 0;

    for (let i = 0; i < DEFAULT_RATE_LIMIT_CONFIG.feedbackPerIpPrefix + 5; i += 1) {
      const decision = await limiter.publicFeedback({
        ...SUBJECT,
        anonymousSessionId: `rotating-${i}`,
      });
      if (decision.allowed) allowed += 1;
    }

    expect(allowed).toBe(DEFAULT_RATE_LIMIT_CONFIG.feedbackPerIpPrefix);
  });

  it('treats a different network prefix independently', async () => {
    const { limiter } = limiterAt(1_000_000);

    for (let i = 0; i < DEFAULT_RATE_LIMIT_CONFIG.feedbackPerIpPrefix + 2; i += 1) {
      await limiter.publicFeedback({ ...SUBJECT, anonymousSessionId: `r-${i}` });
    }

    const elsewhere = await limiter.publicFeedback({
      ...SUBJECT,
      anonymousSessionId: 'fresh',
      ip: '198.51.100.7',
    });
    expect(elsewhere.allowed).toBe(true);
  });

  /** 13_Security_Privacy_Compliance.md: a raw IP is never a key. */
  it('never puts a raw IP or session id in a key', async () => {
    const check = publicFeedbackCheck(SUBJECT);

    for (const dimension of check.dimensions) {
      expect(dimension.key).not.toContain(SUBJECT.ip);
      expect(dimension.key).not.toContain(SUBJECT.anonymousSessionId);
    }
  });
});

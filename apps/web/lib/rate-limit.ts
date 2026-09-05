import Redis from 'ioredis';
import {
  MemoryRateLimitStore,
  RateLimiter,
  RedisRateLimitStore,
  type RateLimitDecision,
} from '@ai-review/core';
import { env } from './env';

/**
 * The process-wide limiter (AC-032, AC-002, E8-02).
 *
 * Two stores, deliberately. Redis is the real one — it is the only store that sees every
 * container's traffic, and a per-process limit would multiply by the replica count. The
 * in-memory store is wired as a fallback so that a Redis outage degrades to per-process
 * limiting rather than to none at all: strictly weaker than intended, but not an open door,
 * which is the honest reading of AC-035 (infrastructure degradation must not break the
 * customer flow) against AC-032 (the endpoint must resist bot loops).
 *
 * `onStoreUnavailable` logs every fallback because a limiter that is quietly not limiting is
 * the failure nobody notices. In production this belongs on an alert, per the runbook's
 * "suspicious generation burst" line.
 */

let cached: RateLimiter | undefined;
let redis: Redis | undefined;

function redisClient(): Redis {
  redis ??= new Redis(env().REDIS_URL, {
    // A limiter must not hold a request open waiting for Redis. Failing fast hands control to
    // the fallback store, which is the whole point of having one.
    maxRetriesPerRequest: 1,
    connectTimeout: 1_000,
    commandTimeout: 1_000,
    enableOfflineQueue: false,
    lazyConnect: true,
  });
  return redis;
}

export function rateLimiter(): RateLimiter {
  cached ??= new RateLimiter(new RedisRateLimitStore(redisClient()), {
    fallbackStore: new MemoryRateLimitStore(),
    onStoreUnavailable: (error, checkName) => {
      console.warn(`[rate-limit] ${checkName} fell back to in-process limiting`, error);
    },
  });
  return cached;
}

/**
 * Client IP from the edge.
 *
 * Cloudflare sits in front (ADR-009), so `cf-connecting-ip` is the trustworthy header and
 * `x-forwarded-for` is only a fallback for local development. The value is never stored: the
 * limiter hashes a truncated prefix (13_Security_Privacy_Compliance.md).
 */
export function clientIp(request: Request): string {
  const cf = request.headers.get('cf-connecting-ip');
  if (cf) return cf.trim();

  const forwarded = request.headers.get('x-forwarded-for') ?? '';
  return forwarded.split(',')[0]?.trim() ?? '';
}

/** True when the decision denies the request, narrowing for the caller. */
export function isDenied(
  decision: RateLimitDecision,
): decision is Extract<RateLimitDecision, { allowed: false }> {
  return !decision.allowed;
}

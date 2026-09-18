import Redis from 'ioredis';
import { isIP } from 'node:net';
import {
  DEFAULT_RATE_LIMIT_CONFIG,
  MemoryRateLimitStore,
  type RateLimitConfig,
  type RateLimitDecision,
  RateLimiter,
  RedisRateLimitStore,
} from '@ai-review/core';
import { env } from './env';
import { safeError } from './safe-error';

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
  if (!redis) {
    redis = new Redis(env().REDIS_URL, {
      // A limiter must not hold a request open waiting for Redis. Failing fast hands control to
      // the fallback store, which is the whole point of having one.
      maxRetriesPerRequest: 1,
      connectTimeout: 1_000,
      commandTimeout: 1_000,
      enableOfflineQueue: false,
      lazyConnect: true,
    });

    // ioredis prints its own "Unhandled error event" warning when a client has no listener. The
    // rejected command is still reported by RateLimiter's onStoreUnavailable callback below, so
    // this prevents duplicate dev-server noise without hiding the operational failure.
    redis.on('error', () => undefined);
  }
  return redis;
}

/**
 * Fallback warnings, once per check per process rather than once per request.
 *
 * With no Redis running every request fell back, and every fallback printed the full ioredis
 * stack — a screen of identical traces per customer that buried the one line that mattered when
 * generation actually failed. The first occurrence still carries the error; later ones are a
 * single line, so the condition stays visible without drowning everything else.
 */
const fallbackSeen = new Set<string>();

export function rateLimiter(): RateLimiter {
  cached ??= new RateLimiter(new RedisRateLimitStore(redisClient()), {
    fallbackStore: new MemoryRateLimitStore(),
    config: scaledConfig(),
    onStoreUnavailable: (error, checkName) => {
      if (fallbackSeen.has(checkName)) return;
      fallbackSeen.add(checkName);
      const reason = safeError(error);
      console.warn(
        `[rate-limit] ${checkName} fell back to in-process limiting (${reason}). ` +
          'Limits are per instance until Redis is reachable; reported once per process.',
      );
    },
  });
  return cached;
}

/**
 * The calibrated policy, with every allowance scaled by RATE_LIMIT_MULTIPLIER.
 *
 * The multiplier is 1 in production, so this returns the defaults untouched. Only counts are
 * scaled — never a window — because widening a window changes what the rule means, while raising
 * a count only changes how much headroom a known-good client has.
 */
function scaledConfig(): RateLimitConfig {
  const factor = env().RATE_LIMIT_MULTIPLIER;
  if (factor === 1) return DEFAULT_RATE_LIMIT_CONFIG;

  const scale = (value: number): number => Math.ceil(value * factor);

  return {
    ...DEFAULT_RATE_LIMIT_CONFIG,
    sessionGenerationsPerHour: scale(DEFAULT_RATE_LIMIT_CONFIG.sessionGenerationsPerHour),
    sessionBurstLimit: scale(DEFAULT_RATE_LIMIT_CONFIG.sessionBurstLimit),
    ipPrefixBaseLimit: scale(DEFAULT_RATE_LIMIT_CONFIG.ipPrefixBaseLimit),
    ipPrefixPerSessionLimit: scale(DEFAULT_RATE_LIMIT_CONFIG.ipPrefixPerSessionLimit),
    ipPrefixCeiling: scale(DEFAULT_RATE_LIMIT_CONFIG.ipPrefixCeiling),
    fairUseGenerationsPerHour: scale(DEFAULT_RATE_LIMIT_CONFIG.fairUseGenerationsPerHour),
    loginFailuresPerIdentity: scale(DEFAULT_RATE_LIMIT_CONFIG.loginFailuresPerIdentity),
    loginFailuresPerIpPrefix: scale(DEFAULT_RATE_LIMIT_CONFIG.loginFailuresPerIpPrefix),
    loginFailuresPerIdentityPerDay: scale(DEFAULT_RATE_LIMIT_CONFIG.loginFailuresPerIdentityPerDay),
    mfaFailuresPerSession: scale(DEFAULT_RATE_LIMIT_CONFIG.mfaFailuresPerSession),
    mfaFailuresPerIpPrefix: scale(DEFAULT_RATE_LIMIT_CONFIG.mfaFailuresPerIpPrefix),
    mfaFailuresPerUserPerDay: scale(DEFAULT_RATE_LIMIT_CONFIG.mfaFailuresPerUserPerDay),
    feedbackPerSession: scale(DEFAULT_RATE_LIMIT_CONFIG.feedbackPerSession),
    feedbackPerIpPrefix: scale(DEFAULT_RATE_LIMIT_CONFIG.feedbackPerIpPrefix),
  };
}

/**
 * Client IP from the edge.
 *
 * Vercel aliases are reachable directly: callers can forge cf-connecting-ip there. On Vercel
 * trust only its overwritten forwarding headers. The Cloudflare header is retained solely for
 * local tunnel development, never as a production fallback. Invalid/missing addresses share
 * the limiter's unknown-address bucket rather than accepting attacker-chosen identifiers.
 */
export function clientIp(request: Request): string {
  if (process.env.VERCEL === '1') {
    const address = (
      request.headers.get('x-vercel-forwarded-for') ??
      request.headers.get('x-forwarded-for') ??
      ''
    ).trim();
    return isIP(address) ? address : '';
  }
  if (process.env.NODE_ENV === 'production') return '';
  const cf = request.headers.get('cf-connecting-ip');
  if (cf && isIP(cf.trim())) return cf.trim();

  const forwarded = request.headers.get('x-forwarded-for') ?? '';
  const address = forwarded.split(',')[0]?.trim() ?? '';
  return isIP(address) ? address : '';
}

/** True when the decision denies the request, narrowing for the caller. */
export function isDenied(
  decision: RateLimitDecision,
): decision is Extract<RateLimitDecision, { allowed: false }> {
  return !decision.allowed;
}

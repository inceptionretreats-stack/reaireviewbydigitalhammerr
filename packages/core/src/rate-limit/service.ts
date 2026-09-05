import {
  DEFAULT_RATE_LIMIT_CONFIG,
  ipSessionSetKey,
  loginFailureCheck,
  loginSuccessCheck,
  publicFeedbackCheck,
  publicGenerationCheck,
  sessionMember,
  type LoginSubject,
  type PublicFeedbackSubject,
  type PublicGenerationSubject,
  type RateLimitConfig,
} from './policies';
import type {
  RateLimitCheck,
  RateLimitDecision,
  RateLimitErrorCode,
  RateLimitReading,
  RateLimitStore,
  RateLimitWindow,
} from './types';

/**
 * Composes several keyed dimensions into one decision (AC-032) and turns it into something an
 * endpoint can answer with: a 23_API_Error_Codes.md code, the dimension that tripped, and a
 * Retry-After.
 *
 * ## What happens when Redis is down
 *
 * This is a real failure mode with no comfortable answer, and the two acceptance criteria
 * that bear on it pull in opposite directions. AC-035 says an infrastructure failure must not
 * prevent generation, copy or navigation, and 02_System_Architecture.md says the same thing
 * about the public flow more generally. AC-032 says the public endpoint resists abuse. Redis
 * being unreachable makes one of the two temporarily untrue; the design has to choose which,
 * per surface, and say so out loud.
 *
 * The choice made here, in order of preference:
 *
 *  1. **Degrade, do not choose.** A `fallbackStore` (MemoryRateLimitStore) keeps limiting
 *     per-container while Redis is unreachable. With N containers the effective limit is N
 *     times the configured one — at the launch footprint N is 2, so a 10/hour session limit
 *     becomes at worst 20/hour, which is still a limit. This is the recommended wiring and it
 *     dissolves most of the dilemma.
 *  2. **Public generation fails OPEN** if there is no fallback either. AC-035 wins, for a
 *     reason beyond the letter of it: abuse is not actually unbounded in that state. A Free
 *     business is capped at ten lifetime generations by the Postgres quota counter (AC-013),
 *     which does not involve Redis at all, and a Pro business is fair-use by decision (D-006).
 *     The rate limiter shapes traffic; the quota is the hard bound, and it survives.
 *  3. **Login fails CLOSED.** There is no equivalent backstop for credential stuffing — no
 *     durable counter caps password guesses — so failing open here would turn any Redis
 *     outage into an unmetered guessing window against every account, and an attacker who can
 *     cause the outage gets to choose when. The cost is bounded and visible: the dashboard
 *     rejects logins during an outage while the public review flow, which is the revenue path
 *     and the thing AC-035 protects, is untouched. Both defaults are per-check
 *     (`onStoreUnavailable`), so an operator can invert either one without a deploy of this
 *     module.
 *
 * `onStoreUnavailable` is called on every store failure precisely because a limiter that is
 * silently not limiting is worse than one that is down. Wire it to an alert.
 */

/** How long to tell a client to wait when a check failed closed. */
export const DEGRADED_RETRY_AFTER_SECONDS = 30;

export interface RateLimiterOptions {
  /** Injected so window boundaries can be tested without sleeping. */
  readonly now?: () => number;
  /** Second-line store used when the primary throws. See the class comment. */
  readonly fallbackStore?: RateLimitStore;
  /** Alerting hook. Must not throw; it is called on a request path. */
  readonly onStoreUnavailable?: (error: unknown, checkName: string) => void;
  readonly config?: RateLimitConfig;
}

export class RateLimiter {
  private readonly clock: () => number;
  private readonly config: RateLimitConfig;

  constructor(
    private readonly store: RateLimitStore,
    private readonly options: RateLimiterOptions = {},
  ) {
    this.clock = options.now ?? (() => Date.now());
    this.config = options.config ?? DEFAULT_RATE_LIMIT_CONFIG;
  }

  /** Evaluates every dimension and records a hit on each, iff all enforced ones have room. */
  consume(check: RateLimitCheck): Promise<RateLimitDecision> {
    return this.evaluate(check, true);
  }

  /** Evaluates without recording. Used before an attempt whose cost depends on the outcome. */
  inspect(check: RateLimitCheck): Promise<RateLimitDecision> {
    return this.evaluate(check, false);
  }

  /**
   * Clears a check's windows. Never throws: this runs after a *successful* login, and a Redis
   * outage must not turn a valid password into an error page. The worst case of swallowing is
   * that earlier failures stay counted, which is the safe direction.
   */
  async forgive(check: RateLimitCheck): Promise<void> {
    try {
      await this.store.forget(check.dimensions);
    } catch (error) {
      this.report(error, check.name);
    }
    if (this.options.fallbackStore) {
      try {
        await this.options.fallbackStore.forget(check.dimensions);
      } catch (error) {
        this.report(error, check.name);
      }
    }
  }

  /**
   * The public generation check (AC-032). Four dimensions, one atomic decision, one reported
   * cause.
   *
   * The distinct-session count that sizes the adaptive IP-prefix limit is read first and is
   * therefore not part of the atomic step. That is deliberate and safe: it is an input to a
   * limit, not to a decision about a counter, and a count that is one request stale changes
   * the allowance by at most `ipPrefixPerSessionLimit`. Making it atomic with the rest would
   * mean writing the distinct-set inside the same script even for requests the script goes on
   * to refuse, which is the worse trade.
   */
  async publicGeneration(subject: PublicGenerationSubject): Promise<RateLimitDecision> {
    const now = this.clock();
    const distinctSessions = await this.countDistinctSessions(subject, now);
    return this.consume(publicGenerationCheck(subject, distinctSessions, this.config));
  }

  /** Private-feedback submission (E8-02). Two dimensions, one atomic decision. */
  publicFeedback(subject: PublicFeedbackSubject): Promise<RateLimitDecision> {
    return this.consume(publicFeedbackCheck(subject, this.config));
  }

  /** AC-002: called *before* verifying the password, so a locked-out identity never gets to. */
  loginAttempt(subject: LoginSubject): Promise<RateLimitDecision> {
    return this.inspect(loginFailureCheck(subject, this.config));
  }

  /** AC-002 / AUTH-02-02: called after the password check fails. Failures are what count. */
  loginFailure(subject: LoginSubject): Promise<RateLimitDecision> {
    return this.consume(loginFailureCheck(subject, this.config));
  }

  /**
   * A correct password forgives that account's earlier failures, so a run of typos is not a
   * lockout. It does not forgive the IP-prefix window — see loginSuccessCheck for why.
   */
  loginSuccess(subject: LoginSubject): Promise<void> {
    return this.forgive(loginSuccessCheck(subject, this.config));
  }

  private async countDistinctSessions(
    subject: PublicGenerationSubject,
    now: number,
  ): Promise<number> {
    const request = {
      key: ipSessionSetKey(subject),
      member: sessionMember(subject),
      windowMs: this.config.ipPrefixWindowMs,
      now,
    };

    try {
      return await this.store.countDistinct(request);
    } catch (error) {
      this.report(error, 'public_generation.distinct_sessions');
      // 1, not 0: this request's own session is one, and it is also the value that yields the
      // tightest adaptive limit. Being conservative here costs a shared venue some headroom
      // during an outage; being generous would hand an attacker the ceiling for free.
      return 1;
    }
  }

  private async evaluate(check: RateLimitCheck, record: boolean): Promise<RateLimitDecision> {
    const now = this.clock();

    try {
      return this.decide(check, await this.call(this.store, check, record, now), false);
    } catch (error) {
      this.report(error, check.name);
    }

    const fallback = this.options.fallbackStore;
    if (fallback) {
      try {
        return this.decide(check, await this.call(fallback, check, record, now), true);
      } catch (error) {
        this.report(error, check.name);
      }
    }

    return this.degraded(check);
  }

  private call(
    store: RateLimitStore,
    check: RateLimitCheck,
    record: boolean,
    now: number,
  ): Promise<RateLimitReading> {
    return record ? store.consume(check.dimensions, now) : store.inspect(check.dimensions, now);
  }

  private decide(
    check: RateLimitCheck,
    reading: RateLimitReading,
    degraded: boolean,
  ): RateLimitDecision {
    const softExceeded = reading.windows.filter(
      (window) => window.enforcement === 'OBSERVE' && window.exceeded,
    );

    const tripped =
      reading.trippedIndex === null ? undefined : reading.windows[reading.trippedIndex];

    if (!tripped) {
      return {
        allowed: true,
        check: check.name,
        windows: reading.windows,
        softExceeded,
        degraded,
      };
    }

    return {
      allowed: false,
      check: check.name,
      code: codeFor(tripped.dimension, check),
      dimension: tripped.dimension,
      retryAfterSeconds: toRetryAfterSeconds(tripped.retryAfterMs),
      windows: reading.windows,
      softExceeded,
      degraded,
    };
  }

  private degraded(check: RateLimitCheck): RateLimitDecision {
    const base = {
      check: check.name,
      windows: [] as readonly RateLimitWindow[],
      softExceeded: [] as readonly RateLimitWindow[],
      degraded: true,
    };

    if (check.onStoreUnavailable === 'ALLOW') {
      return { ...base, allowed: true };
    }

    return {
      ...base,
      allowed: false,
      code: check.dimensions[0]?.rule.code ?? 'PUBLIC_RATE_LIMITED',
      dimension: `${check.name}.store_unavailable`,
      retryAfterSeconds: DEGRADED_RETRY_AFTER_SECONDS,
    };
  }

  private report(error: unknown, checkName: string): void {
    const observer = this.options.onStoreUnavailable;
    if (!observer) return;
    try {
      observer(error, checkName);
    } catch {
      // An alerting hook must never be able to fail a customer request.
    }
  }
}

function codeFor(dimension: string, check: RateLimitCheck): RateLimitErrorCode {
  const match = check.dimensions.find((candidate) => candidate.rule.name === dimension);
  return match?.rule.code ?? 'PUBLIC_RATE_LIMITED';
}

/** Retry-After is whole seconds, and 0 would mean "retry immediately" — round up, floor at 1. */
export function toRetryAfterSeconds(retryAfterMs: number): number {
  return Math.max(1, Math.ceil(retryAfterMs / 1000));
}

/**
 * Response headers for a decision.
 *
 * OBSERVE dimensions are excluded on purpose. Publishing the fair-use window in an
 * X-RateLimit-Limit header is precisely the "hidden hard cap advertised to normal users" that
 * D-006 rules out — and it would be a lie as well, since the dimension never denies anything.
 * The most constrained enforced dimension is the one described.
 */
export function rateLimitHeaders(decision: RateLimitDecision): Record<string, string> {
  const enforced = decision.windows.filter((window) => window.enforcement === 'ENFORCE');
  const headers: Record<string, string> = {};

  const tightest = enforced.reduce<RateLimitWindow | null>((best, window) => {
    if (!best) return window;
    if (window.remaining !== best.remaining)
      return window.remaining < best.remaining ? window : best;
    return window.windowMs < best.windowMs ? window : best;
  }, null);

  if (tightest) {
    headers['X-RateLimit-Limit'] = String(tightest.limit);
    headers['X-RateLimit-Remaining'] = String(tightest.remaining);
  }

  if (!decision.allowed) {
    headers['Retry-After'] = String(decision.retryAfterSeconds);
  }

  return headers;
}

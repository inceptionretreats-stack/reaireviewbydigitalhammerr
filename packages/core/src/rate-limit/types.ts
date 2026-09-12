/**
 * Multi-dimension sliding-window rate limiting (AC-032, AC-002, AUTH-02-02).
 *
 * The rules this has to satisfy, gathered from across the pack because no single document
 * states them together:
 *
 *  - Per anonymous session: recommended <= 10 generations/hour/business
 *    (09_AI_Prompt_and_Generation_Spec.md "Abuse controls").
 *  - Per IP prefix: an *adaptive* limit, not a flat one — see policies.ts for why a flat
 *    per-IP limit is unusable in this market.
 *  - Paid abuse observation: soft alerting at a configurable hourly threshold, independent of
 *    the advertised 2,000-draft annual plan allowance.
 *  - AC-032: the public generation endpoint is limited across MULTIPLE dimensions in one
 *    decision, and the decision must say which dimension tripped — otherwise the endpoint
 *    cannot return a meaningful Retry-After and support cannot diagnose a false positive.
 *  - AC-002 / AUTH-02-02: repeated login failures are limited.
 *  - 13_Security_Privacy_Compliance.md: a raw IP is never a key. Keys are built from
 *    ipPrefixHash / privacyHash only, which policies.ts enforces structurally.
 *
 * The window is a sliding *log*: one sorted-set entry per admitted hit. At the limits in play
 * here (10/hour, 5/15min) an exact log costs a handful of entries per key, and it makes the
 * two things the caller actually needs — "was this admitted" and "when does a slot free" —
 * exact rather than estimated. A fixed-bucket counter would admit 2x the limit across a
 * bucket boundary, which is precisely the "simple bot loop" AC-032 names.
 */

export type RateLimitErrorCode = 'PUBLIC_RATE_LIMITED' | 'AUTH_RATE_LIMITED' | 'FAIR_USE_THROTTLED';

/**
 * OBSERVE dimensions count and report but never deny. Paid annual entitlement is enforced by the
 * durable quota store; this layer detects unusual short-term traffic.
 */
export type RateLimitEnforcement = 'ENFORCE' | 'OBSERVE';

/** What to do when the backing store is unreachable. See service.ts for the justification. */
export type StoreUnavailablePolicy = 'ALLOW' | 'DENY';

export interface RateLimitRule {
  /** Stable dimension name. Reported on a denial and used in the key, so do not rename it. */
  readonly name: string;
  readonly limit: number;
  readonly windowMs: number;
  /** 23_API_Error_Codes.md code returned when this dimension is the one that trips. */
  readonly code: RateLimitErrorCode;
  readonly enforcement: RateLimitEnforcement;
}

/** A rule bound to one already-hashed subject for this request. */
export interface RateLimitDimension {
  readonly rule: RateLimitRule;
  readonly key: string;
}

export interface RateLimitWindow {
  readonly dimension: string;
  readonly key: string;
  readonly limit: number;
  readonly windowMs: number;
  /** Hits inside the window after this call, including the one just recorded. */
  readonly count: number;
  readonly remaining: number;
  /** True when this dimension was already full, i.e. it refused this call. */
  readonly exceeded: boolean;
  /** Milliseconds until a slot frees. 0 while the dimension has room. */
  readonly retryAfterMs: number;
  readonly enforcement: RateLimitEnforcement;
}

export interface RateLimitReading {
  /** True when every enforced dimension had room and hits were written. */
  readonly recorded: boolean;
  /**
   * Index into `windows` of the first ENFORCE dimension found full, or null.
   *
   * The store decides this, not the caller: the decision and the write have to happen inside
   * one atomic step, so re-deriving it here from the returned counts would be a second,
   * racier source of truth.
   */
  readonly trippedIndex: number | null;
  readonly windows: readonly RateLimitWindow[];
}

/**
 * Storage contract.
 *
 * `consume` MUST evaluate every dimension and write every hit as one atomic step. Two
 * separate properties depend on that, and both fail under a read-then-write implementation:
 *
 *  1. Concurrency. N simultaneous requests all read count = limit - 1, all decide "room", and
 *     all write. The window admits N, not one. This is the same race the quota module
 *     documents (quota/types.ts) and it bites harder here, because a bot loop *is* concurrent
 *     requests by construction.
 *  2. Cross-dimension consistency. If dimension A is written before dimension B is checked,
 *     a request denied by B has still spent a hit on A. A bot can then trip the cheap
 *     dimension deliberately and drain windows it is not even being measured on.
 *     Check-all-then-commit is why the Redis implementation needs Lua rather than MULTI/EXEC
 *     — see redis-store.ts.
 */
export interface RateLimitStore {
  /** Evaluates every dimension and records a hit on each iff all enforced ones have room. */
  consume(dimensions: readonly RateLimitDimension[], now: number): Promise<RateLimitReading>;

  /** Same evaluation, no write. Used before a login attempt, which counts failures only. */
  inspect(dimensions: readonly RateLimitDimension[], now: number): Promise<RateLimitReading>;

  /** Clears the windows. A successful login forgives earlier failures (AC-002). */
  forget(dimensions: readonly RateLimitDimension[]): Promise<void>;

  /**
   * Sliding-window count of distinct members for one key, recording `member` as it goes.
   * Sizes the adaptive IP-prefix limit (policies.ts).
   */
  countDistinct(request: DistinctCountRequest): Promise<number>;
}

export interface DistinctCountRequest {
  readonly key: string;
  readonly member: string;
  readonly windowMs: number;
  readonly now: number;
}

/** One composed decision: several dimensions, one verdict, one error code. */
export interface RateLimitCheck {
  readonly name: string;
  readonly dimensions: readonly RateLimitDimension[];
  readonly onStoreUnavailable: StoreUnavailablePolicy;
}

interface RateLimitDecisionBase {
  readonly check: string;
  readonly windows: readonly RateLimitWindow[];
  /**
   * OBSERVE dimensions over their threshold. Abuse alerting reads this; it is never a reason to
   * deny, and it never reaches a response header.
   */
  readonly softExceeded: readonly RateLimitWindow[];
  /** True when the primary store was unreachable and this verdict came from elsewhere. */
  readonly degraded: boolean;
}

export interface RateLimitAllowed extends RateLimitDecisionBase {
  readonly allowed: true;
}

export interface RateLimitDenied extends RateLimitDecisionBase {
  readonly allowed: false;
  readonly code: RateLimitErrorCode;
  /** Which dimension tripped (AC-032). Safe to log: it is a rule name, not subject data. */
  readonly dimension: string;
  /** Ready for the Retry-After header. Always >= 1, because Retry-After: 0 means "now". */
  readonly retryAfterSeconds: number;
}

export type RateLimitDecision = RateLimitAllowed | RateLimitDenied;

/**
 * Shapes one window from the raw store reading. Shared by both stores so the two
 * implementations cannot drift on the arithmetic — the memory store is only a useful test
 * double while it reports identically to Redis.
 *
 * `countBefore` is the count *before* this call, and that is what decides `exceeded`: a call
 * taking the last slot is admitted even though the window ends up full.
 *
 * `releaseAt` is the score of the entry at index (countBefore - limit): the last entry that
 * must age out before a slot frees, or -1 when the window has room. Using the *oldest* entry
 * instead would under-report whenever a window sits above its limit — which OBSERVE
 * dimensions do by design, and ENFORCE dimensions do after an operator lowers a limit.
 */
export function toWindow(
  dimension: RateLimitDimension,
  countBefore: number,
  releaseAt: number,
  recorded: boolean,
  now: number,
): RateLimitWindow {
  const { rule, key } = dimension;
  const exceeded = countBefore >= rule.limit;
  const count = countBefore + (recorded ? 1 : 0);

  return {
    dimension: rule.name,
    key,
    limit: rule.limit,
    windowMs: rule.windowMs,
    count,
    remaining: Math.max(0, rule.limit - count),
    exceeded,
    retryAfterMs: exceeded && releaseAt >= 0 ? Math.max(1, releaseAt + rule.windowMs - now) : 0,
    enforcement: rule.enforcement,
  };
}

import { ipPrefixHash, privacyHash } from '../auth/tokens';
import type { RateLimitCheck, RateLimitDimension, RateLimitRule } from './types';

/**
 * The concrete limits from 09_AI_Prompt_and_Generation_Spec.md "Abuse controls", plus the key
 * construction that keeps 13_Security_Privacy_Compliance.md satisfied.
 *
 * Everything tunable lives in RateLimitConfig rather than being inlined, because
 * 19_Admin_Panel_Spec.md puts abuse thresholds under platform configuration: these values are
 * bootstrap defaults in exactly the way FREE_AI_GENERATION_LIMIT is (see packages/config).
 */

const KEY_NAMESPACE = 'rl:v1';

export const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

export interface RateLimitConfig {
  /** 09 spec, verbatim: "Per anonymous session: recommended <= 10 generations/hour/business". */
  readonly sessionGenerationsPerHour: number;

  /**
   * Short burst window. The 10/hour rule alone does not stop a bot loop — a script can fire
   * all ten inside two seconds and only then be told to stop, and AC-032 asks for resistance
   * to exactly that. Three in twenty seconds is well above human pace (a customer has to read
   * a draft before regenerating) and well below a loop's.
   */
  readonly sessionBurstLimit: number;
  readonly sessionBurstWindowMs: number;

  /**
   * Adaptive per-IP-prefix limit. Keys are /24 (IPv4) or /48 (IPv6) prefixes, so one key can
   * be one home connection or an entire café, mall or mobile-carrier NAT — which in the
   * Indian market this product sells into is the common case, not the exception. A flat limit
   * is therefore either too tight for a busy venue (the exact venue that bought the QR stand)
   * or too loose to be a control at all.
   *
   * Resolution: the prefix's allowance grows with the number of distinct anonymous sessions
   * seen from it in the last hour, and is hard-clamped at a ceiling.
   */
  readonly ipPrefixBaseLimit: number;
  readonly ipPrefixPerSessionLimit: number;
  readonly ipPrefixCeiling: number;
  readonly ipPrefixWindowMs: number;

  /**
   * Paid abuse threshold, per business per hour. OBSERVE, so it alerts and never denies.
   * The FAIR_USE_THROTTLED code in 23_API_Error_Codes.md only becomes reachable if
   * an operator promotes this rule to ENFORCE for a specific abusing tenant.
   */
  readonly fairUseGenerationsPerHour: number;

  /** AC-002 / AUTH-02-02. Per account, per IP prefix, and a slow-drip cap per account. */
  readonly loginFailuresPerIdentity: number;
  readonly loginIdentityWindowMs: number;
  readonly loginFailuresPerIpPrefix: number;
  readonly loginIpPrefixWindowMs: number;
  readonly loginFailuresPerIdentityPerDay: number;

  /**
   * Private-feedback submission (E8-02, and the WAF/rate-limit line in
   * 13_Security_Privacy_Compliance.md, which names the feedback endpoint alongside AI and auth).
   *
   * The threat here is spam rather than cost: feedback is free to serve but lands in a business
   * owner's inbox, and an inbox flooded with junk is an inbox they stop opening. Limits are
   * therefore tighter than generation but generous against real use — a customer with a genuine
   * complaint may legitimately send a second message after remembering something.
   *
   * D-010 constrains how tight this may be: private feedback is available to EVERY visitor, so
   * this must never become a de facto gate on being heard.
   */
  readonly feedbackPerSession: number;
  readonly feedbackSessionWindowMs: number;
  readonly feedbackPerIpPrefix: number;
  readonly feedbackIpPrefixWindowMs: number;
}

export const DEFAULT_RATE_LIMIT_CONFIG: RateLimitConfig = {
  sessionGenerationsPerHour: 10,
  sessionBurstLimit: 3,
  sessionBurstWindowMs: 20 * 1000,

  // Base is 2x the per-session hourly cap, so a single-session prefix is bounded by its
  // session limit rather than by this one; the prefix rule only starts to bind when several
  // sessions share it. Growth of 8 is deliberately *below* the 10/hour session cap, so
  // fabricating sessions to inflate the allowance is a losing trade per fabricated session.
  ipPrefixBaseLimit: 20,
  ipPrefixPerSessionLimit: 8,
  // The ceiling, not the adaptivity, is the actual abuse bound: an attacker who rotates
  // session identifiers can always climb to it. 240/hour is roughly 24 genuinely busy
  // customers on one venue's wifi, and is still far below what a loop would produce.
  ipPrefixCeiling: 240,
  ipPrefixWindowMs: HOUR_MS,

  fairUseGenerationsPerHour: 300,

  loginFailuresPerIdentity: 5,
  loginIdentityWindowMs: 15 * MINUTE_MS,
  // Higher than the per-account limit because one office NAT holds many legitimate accounts,
  // but low enough that spraying one password across many accounts from one prefix trips.
  loginFailuresPerIpPrefix: 25,
  loginIpPrefixWindowMs: 15 * MINUTE_MS,
  // Blunts the slow drip that waits out each 15-minute window: 5 per window would otherwise
  // be 480 guesses a day against one account.
  loginFailuresPerIdentityPerDay: 20,

  feedbackPerSession: 3,
  feedbackSessionWindowMs: 10 * MINUTE_MS,
  // Sized for a shared venue connection, per the same NAT reasoning as the generation prefix.
  feedbackPerIpPrefix: 20,
  feedbackIpPrefixWindowMs: HOUR_MS,
};

export interface RateLimitRuleSet {
  readonly sessionHourly: RateLimitRule;
  readonly sessionBurst: RateLimitRule;
  readonly fairUse: RateLimitRule;
  readonly loginIdentity: RateLimitRule;
  readonly loginIpPrefix: RateLimitRule;
  readonly loginIdentityDaily: RateLimitRule;
  readonly feedbackSession: RateLimitRule;
  readonly feedbackIpPrefix: RateLimitRule;
}

export function rules(config: RateLimitConfig): RateLimitRuleSet {
  return {
    sessionHourly: {
      name: 'public.session_hourly',
      limit: config.sessionGenerationsPerHour,
      windowMs: HOUR_MS,
      code: 'PUBLIC_RATE_LIMITED',
      enforcement: 'ENFORCE',
    },
    sessionBurst: {
      name: 'public.session_burst',
      limit: config.sessionBurstLimit,
      windowMs: config.sessionBurstWindowMs,
      code: 'PUBLIC_RATE_LIMITED',
      enforcement: 'ENFORCE',
    },
    fairUse: {
      name: 'public.business_fair_use',
      limit: config.fairUseGenerationsPerHour,
      windowMs: HOUR_MS,
      code: 'FAIR_USE_THROTTLED',
      enforcement: 'OBSERVE',
    },
    loginIdentity: {
      name: 'auth.login_identity',
      limit: config.loginFailuresPerIdentity,
      windowMs: config.loginIdentityWindowMs,
      code: 'AUTH_RATE_LIMITED',
      enforcement: 'ENFORCE',
    },
    loginIpPrefix: {
      name: 'auth.login_ip_prefix',
      limit: config.loginFailuresPerIpPrefix,
      windowMs: config.loginIpPrefixWindowMs,
      code: 'AUTH_RATE_LIMITED',
      enforcement: 'ENFORCE',
    },
    feedbackSession: {
      name: 'public.feedback_session',
      limit: config.feedbackPerSession,
      windowMs: config.feedbackSessionWindowMs,
      code: 'PUBLIC_RATE_LIMITED',
      enforcement: 'ENFORCE',
    },
    feedbackIpPrefix: {
      name: 'public.feedback_ip_prefix',
      limit: config.feedbackPerIpPrefix,
      windowMs: config.feedbackIpPrefixWindowMs,
      code: 'PUBLIC_RATE_LIMITED',
      enforcement: 'ENFORCE',
    },
    loginIdentityDaily: {
      name: 'auth.login_identity_daily',
      limit: config.loginFailuresPerIdentityPerDay,
      windowMs: 24 * HOUR_MS,
      code: 'AUTH_RATE_LIMITED',
      enforcement: 'ENFORCE',
    },
  };
}

/**
 * Builds the per-IP-prefix rule for this request. The limit is a function of the subject, so
 * unlike the others it cannot be a constant.
 */
export function ipPrefixRule(distinctSessions: number, config: RateLimitConfig): RateLimitRule {
  return {
    name: 'public.ip_prefix',
    limit: adaptiveIpPrefixLimit(distinctSessions, config),
    windowMs: config.ipPrefixWindowMs,
    code: 'PUBLIC_RATE_LIMITED',
    enforcement: 'ENFORCE',
  };
}

export function adaptiveIpPrefixLimit(distinctSessions: number, config: RateLimitConfig): number {
  const additional = Math.max(0, Math.floor(distinctSessions) - 1);
  return Math.min(
    config.ipPrefixCeiling,
    config.ipPrefixBaseLimit + additional * config.ipPrefixPerSessionLimit,
  );
}

export class RateLimitKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RateLimitKeyError';
  }
}

const IPV4_LITERAL = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const IPV6_LITERAL = /^[0-9a-f]{0,4}(?::[0-9a-f]{0,4}){2,7}$/i;

/** True for anything that reads as an IP address literal. */
export function looksLikeIpAddress(value: string): boolean {
  return IPV4_LITERAL.test(value) || IPV6_LITERAL.test(value);
}

/**
 * Assembles a key from a rule name and already-safe components.
 *
 * The two guards are not defensive noise. 13_Security_Privacy_Compliance.md forbids keying on
 * a raw IP, and that rule is only as strong as the weakest call site — a future endpoint that
 * passes `request.ip` straight through would silently start writing raw addresses into Redis,
 * where they would sit for the whole window with nothing to notice. Throwing turns that into
 * a failed request and a stack trace instead. The separator guard stops a component that
 * contains ':' from being able to impersonate another subject's key.
 */
export function rateLimitKey(ruleName: string, ...parts: readonly string[]): string {
  for (const part of parts) {
    if (part.length === 0) {
      throw new RateLimitKeyError(`empty key component for rule ${ruleName}`);
    }
    if (looksLikeIpAddress(part)) {
      throw new RateLimitKeyError(
        `refusing to key ${ruleName} on a raw IP address (13_Security_Privacy_Compliance.md); ` +
          'hash it with ipPrefixHash first',
      );
    }
    if (part.includes(':')) {
      throw new RateLimitKeyError(`key component for rule ${ruleName} contains the separator`);
    }
  }
  return [KEY_NAMESPACE, ruleName, ...parts].join(':');
}

export interface PublicGenerationSubject {
  readonly businessId: string;
  /** The anonymous session identifier from the public flow. Hashed before it becomes a key. */
  readonly anonymousSessionId: string;
  /** Raw client IP. Truncated to a prefix and hashed here; never stored or keyed as-is. */
  readonly ip: string;
  /** HASH_PEPPER from packages/config. */
  readonly pepper: string;
  /**
   * Only a Pro business gets the paid abuse-observation dimension. A Free business is
   * already bounded at 10 lifetime generations by the Postgres quota counter (AC-013), so a
   * second per-business window would measure nothing.
   */
  readonly plan: 'FREE' | 'PRO';
}

export interface LoginSubject {
  /** Email or other login identifier as typed. Normalised and hashed before it is a key. */
  readonly identifier: string;
  readonly ip: string;
  readonly pepper: string;
}

/** The key of the set that tracks distinct sessions per prefix, sizing the adaptive limit. */
export function ipSessionSetKey(subject: PublicGenerationSubject): string {
  return rateLimitKey('public.ip_sessions', ipPrefixHash(subject.ip, subject.pepper));
}

export function sessionMember(subject: PublicGenerationSubject): string {
  return privacyHash(subject.anonymousSessionId, subject.pepper);
}

/**
 * The composed public-generation check (AC-032): four dimensions, one atomic decision.
 *
 * `onStoreUnavailable: 'ALLOW'` is the deliberate half of the availability trade-off — see
 * service.ts, where it is argued against AC-035 and AC-032 together.
 */
export function publicGenerationCheck(
  subject: PublicGenerationSubject,
  distinctSessions: number,
  config: RateLimitConfig = DEFAULT_RATE_LIMIT_CONFIG,
): RateLimitCheck {
  const rule = rules(config);
  const session = sessionMember(subject);
  const prefix = ipPrefixHash(subject.ip, subject.pepper);

  const dimensions: RateLimitDimension[] = [
    // Burst first so that a loop is reported against the dimension that actually describes
    // it. The store returns the first tripped dimension, and "you are going too fast" is a
    // more actionable message than "you have used your hourly allowance".
    { rule: rule.sessionBurst, key: rateLimitKey(rule.sessionBurst.name, session) },
    {
      rule: rule.sessionHourly,
      key: rateLimitKey(rule.sessionHourly.name, session, subject.businessId),
    },
    {
      rule: ipPrefixRule(distinctSessions, config),
      key: rateLimitKey('public.ip_prefix', prefix),
    },
  ];

  if (subject.plan === 'PRO') {
    dimensions.push({
      rule: rule.fairUse,
      key: rateLimitKey(rule.fairUse.name, subject.businessId),
    });
  }

  return { name: 'public_generation', dimensions, onStoreUnavailable: 'ALLOW' };
}

/**
 * Normalises before hashing so that `Owner@Example.com ` and `owner@example.com` land in one
 * bucket. Without this, AC-002 is bypassed by retyping the address in a different case.
 */
export function loginIdentityHash(identifier: string, pepper: string): string {
  return privacyHash(identifier.trim().toLowerCase(), pepper);
}

/** AC-002 / AUTH-02-02. Counts login *failures*; a success calls forgive(). */
export function loginFailureCheck(
  subject: LoginSubject,
  config: RateLimitConfig = DEFAULT_RATE_LIMIT_CONFIG,
): RateLimitCheck {
  const rule = rules(config);
  const prefix = ipPrefixHash(subject.ip, subject.pepper);

  return {
    name: 'login_failure',
    dimensions: [
      ...identityDimensions(subject, config),
      { rule: rule.loginIpPrefix, key: rateLimitKey(rule.loginIpPrefix.name, prefix) },
    ],
    // Fails closed. Justified in service.ts against the ALLOW above.
    onStoreUnavailable: 'DENY',
  };
}

/**
 * What a correct password is allowed to forgive: the windows scoped to that account, and
 * nothing else.
 *
 * The IP-prefix window is deliberately excluded. It exists to catch one network spraying one
 * password across many accounts, and an attacker doing that generally holds a valid account
 * of their own — if a success cleared the prefix counter they could reset it whenever they
 * chose, and the dimension would stop existing in practice. The cost of leaving it is that a
 * genuinely busy office can still hit the prefix limit after 25 mistyped passwords in fifteen
 * minutes, which is a support call rather than a breach.
 */
export function loginSuccessCheck(
  subject: LoginSubject,
  config: RateLimitConfig = DEFAULT_RATE_LIMIT_CONFIG,
): RateLimitCheck {
  return {
    name: 'login_success',
    dimensions: identityDimensions(subject, config),
    onStoreUnavailable: 'DENY',
  };
}

function identityDimensions(subject: LoginSubject, config: RateLimitConfig): RateLimitDimension[] {
  const rule = rules(config);
  const identity = loginIdentityHash(subject.identifier, subject.pepper);

  return [
    { rule: rule.loginIdentity, key: rateLimitKey(rule.loginIdentity.name, identity) },
    { rule: rule.loginIdentityDaily, key: rateLimitKey(rule.loginIdentityDaily.name, identity) },
  ];
}

export interface PublicFeedbackSubject {
  readonly businessId: string;
  readonly anonymousSessionId: string;
  /** Raw client IP. Truncated to a prefix and hashed here; never stored or keyed as-is. */
  readonly ip: string;
  /** HASH_PEPPER from packages/config. */
  readonly pepper: string;
}

/**
 * Private-feedback submission check (E8-02).
 *
 * Two dimensions, session before prefix, for the same reason the generation check orders burst
 * first: the tripped dimension is what the caller reports, and "you have sent several already"
 * describes the situation better than a shared-connection limit the visitor cannot see.
 *
 * `onStoreUnavailable: 'ALLOW'` matches the generation check. The reasoning in service.ts
 * applies with more force here, not less: D-010 makes private feedback available to every
 * visitor, so a Redis outage must not silence someone trying to complain to a business.
 */
export function publicFeedbackCheck(
  subject: PublicFeedbackSubject,
  config: RateLimitConfig = DEFAULT_RATE_LIMIT_CONFIG,
): RateLimitCheck {
  const rule = rules(config);
  const session = privacyHash(subject.anonymousSessionId, subject.pepper);
  const prefix = ipPrefixHash(subject.ip, subject.pepper);

  return {
    name: 'public_feedback',
    dimensions: [
      {
        rule: rule.feedbackSession,
        key: rateLimitKey(rule.feedbackSession.name, session, subject.businessId),
      },
      {
        rule: rule.feedbackIpPrefix,
        key: rateLimitKey(rule.feedbackIpPrefix.name, prefix),
      },
    ],
    onStoreUnavailable: 'ALLOW',
  };
}

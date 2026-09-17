import { NextResponse, type NextRequest } from 'next/server';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { users } from '@ai-review/db';
import { loginRequest } from '@ai-review/contracts';
import {
  ADMIN_SESSION_TTL_MS,
  MFA_PENDING_TTL_MS,
  isAdminRole,
  privacyHash,
} from '@ai-review/core';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { apiError } from '@/lib/api-error';
import { verifyCsrf } from '@/lib/csrf';
import { passwordHasher } from '@/lib/auth-helpers';
import {
  adminMfaRequired,
  clearSessionCookie,
  getSession,
  nextPathAfterLogin,
  sessionService,
  setSessionCookie,
} from '@/lib/session';
import { clientIp, isDenied, rateLimiter } from '@/lib/rate-limit';
import { recordActivity } from '@/lib/activity';

/**
 * POST /api/v1/auth/login — AUTH-02.
 *
 * Three requirements shape the order of operations here.
 *
 * AC-002 first half: repeated failures are rate limited. The limiter is INSPECTED before the
 * password is verified, so a locked-out identity never reaches the hash comparison — otherwise
 * an attacker still gets one Argon2id verification per request, which is the expensive part.
 *
 * AC-002 second half: session identifiers rotate after successful authentication. Any session
 * already on this browser is revoked and a fresh token issued, which closes session fixation —
 * a token an attacker planted before login cannot survive it.
 *
 * AUTH-02-01 / uniformity: every failure returns the same code and message. A response that
 * distinguished "no such account" from "wrong password" would turn this endpoint into an
 * account enumerator. A disabled admin account answers exactly the same way, for the same reason.
 *
 * AMENDMENT-027: an admin role gets a ten-minute *pending* session that can reach only the MFA
 * screens; the challenge (or first enrolment) is what turns it into a real admin session.
 * Remember-me is ignored for admins — twelve hours is the ceiling.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const csrf = verifyCsrf(request);
  if (!csrf.ok) return apiError('FORBIDDEN', 'Request rejected.');

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return apiError('VALIDATION_FAILED', 'Malformed request body.');
  }

  const parsed = loginRequest.safeParse(raw);
  if (!parsed.success) {
    return apiError('VALIDATION_FAILED', 'Enter your email and password.');
  }

  const { email, password, remember_me: rememberMe } = parsed.data;
  const ip = clientIp(request);
  const subject = { identifier: email, ip, pepper: env().HASH_PEPPER };
  const limiter = rateLimiter();

  const gate = await limiter.loginAttempt(subject);
  if (isDenied(gate)) {
    return apiError('AUTH_RATE_LIMITED', 'Too many sign-in attempts. Please try again shortly.', {
      retryAfterSeconds: gate.retryAfterSeconds,
    });
  }

  const database = db();
  const [account] = await database
    .select({
      id: users.id,
      role: users.role,
      passwordHash: users.passwordHash,
      lockedUntil: users.lockedUntil,
      disabledAt: users.disabledAt,
      mfaEnabledAt: users.mfaEnabledAt,
    })
    .from(users)
    .where(and(eq(users.email, email), isNull(users.deletedAt)))
    .limit(1);

  // A dummy verification against a real Argon2id hash keeps the timing of "no such account"
  // indistinguishable from "wrong password". Without it, response time is an enumeration oracle
  // regardless of how uniform the body is.
  const hashToCheck = account?.passwordHash ?? DUMMY_HASH;
  const passwordMatches = await passwordHasher().verify(hashToCheck, password);

  const locked = account?.lockedUntil != null && account.lockedUntil.getTime() > Date.now();
  const disabled = account?.disabledAt != null;

  if (!account || !passwordMatches || locked || disabled) {
    const failure = await limiter.loginFailure(subject);

    if (account) {
      await database
        .update(users)
        .set({ failedLoginCount: sql`${users.failedLoginCount} + 1` })
        .where(eq(users.id, account.id));
    }

    // Deliberately the same response whether the account is missing, the password is wrong, or
    // the account is locked. Only the Retry-After differs, and only once the limiter trips.
    recordActivity(
      request,
      { userId: account?.id ?? null },
      {
        action: 'auth.login',
        outcome: 'FAILURE',
        metadata: {
          reason: !account
            ? 'NO_ACCOUNT'
            : disabled
              ? 'DISABLED'
              : locked
                ? 'LOCKED'
                : 'WRONG_PASSWORD',
        },
      },
    );
    return apiError('AUTH_INVALID_CREDENTIALS', 'That email or password is not correct.', {
      ...(isDenied(failure) ? { retryAfterSeconds: failure.retryAfterSeconds } : {}),
    });
  }

  // AC-002: a session already present on this browser must not survive authentication.
  const existing = await getSession();
  if (existing) {
    await sessionService().revoke(existing.sessionId, 'REPLACED_BY_LOGIN');
  }

  await limiter.loginSuccess(subject);

  const session = await sessionService().create({
    userId: account.id,
    userAgent: request.headers.get('user-agent'),
    /*
     * The hash, never the address. `sessions.ip_hash` is char(64) — sized for a SHA-256 digest —
     * and 13_Security_Privacy_Compliance.md requires privacy-preserving hashes rather than a raw
     * IP kept for the 30-day life of a session row. Same function the rate limiter uses, so one
     * address produces one value across the system.
     */
    ipHash: ip ? privacyHash(ip, env().HASH_PEPPER) : null,
    rememberMe: rememberMe ?? false,
    // A pending ten-minute session only while a code is still owed; with the switch off the
    // admin gets the twelve-hour session straight away.
    ...(isAdminRole(account.role)
      ? { ttlMs: adminMfaRequired() ? MFA_PENDING_TTL_MS : ADMIN_SESSION_TTL_MS }
      : {}),
  });

  await setSessionCookie(session.token, session.expiresAt);

  await database
    .update(users)
    .set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() })
    .where(eq(users.id, account.id));

  recordActivity(
    request,
    { userId: account.id },
    { action: 'auth.login', metadata: { role: account.role, remember_me: rememberMe ?? false } },
  );
  const next = nextPathAfterLogin({
    role: account.role,
    mfaEnabledAt: account.mfaEnabledAt,
    mfaVerifiedAt: null,
  });
  return NextResponse.json({
    next,
    mfa:
      !isAdminRole(account.role) || !adminMfaRequired()
        ? null
        : account.mfaEnabledAt
          ? 'challenge'
          : 'enrol',
  });
}

export async function DELETE(): Promise<NextResponse> {
  await clearSessionCookie();
  return new NextResponse(null, { status: 204 });
}

/**
 * A real Argon2id hash of an unguessable value, used only to spend comparison time when no
 * account exists. It must never match anything.
 */
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c29tZS1zdGF0aWMtc2FsdC12YWx1ZQ$0000000000000000000000000000000000000000000';

import { NextResponse, type NextRequest } from 'next/server';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { users } from '@ai-review/db';
import { loginRequest } from '@ai-review/contracts';
import {
  ADMIN_SESSION_TTL_MS,
  MFA_PENDING_TTL_MS,
  SessionService,
  isAdminRole,
  privacyHash,
} from '@ai-review/core';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { apiError } from '@/lib/api-error';
import { verifyCsrf } from '@/lib/csrf';
import { passwordHasher } from '@/lib/auth-helpers';
import { adminMfaRequired, getSession, nextPathAfterLogin, setSessionCookie } from '@/lib/session';
import { clientIp, isDenied, rateLimiter } from '@/lib/rate-limit';
import { recordActivity } from '@/lib/activity';
import { POST as logout } from '../logout/route';

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
      passwordHash: users.passwordHash,
      lockedUntil: users.lockedUntil,
      disabledAt: users.disabledAt,
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

  if (!account || !account.passwordHash || !passwordMatches || locked || disabled) {
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
  const mfaRequired = adminMfaRequired();
  const authenticated = await database.transaction(async (tx) => {
    // Password changes lock this user row before sweeping sessions. Holding the same lock while
    // rechecking the credential and issuing a session means either this login commits first and
    // is swept, or the password change commits first and this stale credential is rejected.
    const [current] = await tx
      .select({
        id: users.id,
        role: users.role,
        passwordHash: users.passwordHash,
        lockedUntil: users.lockedUntil,
        disabledAt: users.disabledAt,
        mfaEnabledAt: users.mfaEnabledAt,
      })
      .from(users)
      .where(and(eq(users.id, account.id), eq(users.email, email), isNull(users.deletedAt)))
      .for('update')
      .limit(1);

    if (
      !current ||
      !current.passwordHash ||
      current.passwordHash !== account.passwordHash ||
      current.disabledAt ||
      (current.lockedUntil && current.lockedUntil.getTime() > Date.now())
    ) {
      return null;
    }

    const service = new SessionService(tx);
    if (existing) await service.revoke(existing.sessionId, 'REPLACED_BY_LOGIN');

    const session = await service.create({
      userId: current.id,
      userAgent: request.headers.get('user-agent'),
      // Persist only the privacy-preserving hash, never the client address itself.
      ipHash: ip ? privacyHash(ip, env().HASH_PEPPER) : null,
      rememberMe: rememberMe ?? false,
      // Admin sessions are pending for MFA or bounded to twelve hours when MFA is off.
      ...(isAdminRole(current.role)
        ? { ttlMs: mfaRequired ? MFA_PENDING_TTL_MS : ADMIN_SESSION_TTL_MS }
        : {}),
    });

    await tx
      .update(users)
      .set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() })
      .where(eq(users.id, current.id));

    return { session, role: current.role, mfaEnabledAt: current.mfaEnabledAt };
  });

  if (!authenticated) {
    return apiError('AUTH_INVALID_CREDENTIALS', 'That email or password is not correct.');
  }

  await limiter.loginSuccess(subject);
  await setSessionCookie(authenticated.session.token, authenticated.session.expiresAt);

  recordActivity(
    request,
    { userId: account.id },
    {
      action: 'auth.login',
      metadata: { role: authenticated.role, remember_me: rememberMe ?? false },
    },
  );
  const next = nextPathAfterLogin(
    { role: authenticated.role, mfaEnabledAt: authenticated.mfaEnabledAt, mfaVerifiedAt: null },
    mfaRequired,
  );
  return NextResponse.json({
    next,
    mfa:
      !isAdminRole(authenticated.role) || !mfaRequired
        ? null
        : authenticated.mfaEnabledAt
          ? 'challenge'
          : 'enrol',
  });
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  return logout(request);
}

/**
 * A real Argon2id hash of an unguessable value, used only to spend comparison time when no
 * account exists. It must never match anything.
 */
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c29tZS1zdGF0aWMtc2FsdC12YWx1ZQ$0000000000000000000000000000000000000000000';

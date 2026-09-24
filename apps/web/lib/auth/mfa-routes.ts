import { NextResponse } from 'next/server';
import {
  ADMIN_SESSION_TTL_MS,
  isAdminRole,
  privacyHash,
  type MfaSubject,
  type SessionContext,
} from '@ai-review/core';
import { apiError } from '@/lib/http/api-error';
import { verifyCsrf } from '@/lib/http/csrf';
import { env } from '@/lib/infra/env';
import { clientIp, isDenied, rateLimiter } from '@/lib/http/rate-limit';
import { getSession, nextPathAfterLogin, sessionService, setSessionCookie } from './session';

/**
 * Shared plumbing for the MFA routes (AMENDMENT-027).
 *
 * These are the only routes an admin session may call *before* it is MFA-verified, which is
 * why they do not use `requireAdmin`: that guard refuses a pending session by design. What
 * they share instead is the CSRF check, the "is this an admin at all" check, and the rate
 * limiter keyed on the pending session — the thing a guesser holds.
 */

export type MfaGate =
  | { ok: true; session: SessionContext; subject: MfaSubject; ipHash: string | null }
  | { ok: false; response: NextResponse };

export async function requirePendingAdmin(request: Request): Promise<MfaGate> {
  const csrf = verifyCsrf(request);
  if (!csrf.ok) return { ok: false, response: apiError('FORBIDDEN', 'Request rejected.') };

  const session = await getSession();
  if (!session) {
    return { ok: false, response: apiError('AUTH_REQUIRED', 'Please sign in and try again.') };
  }
  if (!isAdminRole(session.role)) {
    return { ok: false, response: apiError('FORBIDDEN', 'Request rejected.') };
  }

  const ip = clientIp(request);
  const pepper = env().HASH_PEPPER;
  return {
    ok: true,
    session,
    subject: { sessionId: session.sessionId, userId: session.userId, ip: ip ?? '0.0.0.0', pepper },
    ipHash: ip ? privacyHash(ip, pepper) : null,
  };
}

/** Inspects the limiter before a code is checked; answers 429 with Retry-After when denied. */
export async function mfaRateGate(subject: MfaSubject): Promise<NextResponse | null> {
  const gate = await rateLimiter().mfaAttempt(subject);
  if (isDenied(gate)) {
    return apiError('AUTH_RATE_LIMITED', 'Too many attempts. Please wait and try again.', {
      retryAfterSeconds: gate.retryAfterSeconds,
    });
  }
  return null;
}

/**
 * A failed code counts against the session, the account and the network. After ten failures
 * on one pending session the session itself is revoked: a guesser starts over from a password.
 */
export async function recordMfaFailure(
  subject: MfaSubject,
  session: SessionContext,
): Promise<NextResponse> {
  const decision = await rateLimiter().mfaFailure(subject);
  if (isDenied(decision)) {
    return apiError('AUTH_RATE_LIMITED', 'Too many attempts. Please wait and try again.', {
      retryAfterSeconds: decision.retryAfterSeconds,
    });
  }
  void session;
  return apiError('AUTH_MFA_INVALID', 'That code is not right. Check the app and try again.');
}

/**
 * Turns a pending session into a verified admin session (or refreshes a step-up). The cookie
 * is rewritten with the new expiry so the browser's copy agrees with the row.
 */
export async function completeMfa(session: SessionContext, subject: MfaSubject): Promise<string> {
  const expiresAt = await sessionService().markMfaVerified(session.sessionId, {
    extendToMs: ADMIN_SESSION_TTL_MS,
  });
  await rateLimiter().mfaSuccess(subject);
  const token = await currentSessionToken();
  if (token) await setSessionCookie(token, expiresAt);
  return nextPathAfterLogin({ ...session, mfaVerifiedAt: new Date(), mfaEnabledAt: new Date() });
}

async function currentSessionToken(): Promise<string | null> {
  const { cookies } = await import('next/headers');
  const jar = await cookies();
  return jar.get(env().SESSION_COOKIE_NAME)?.value ?? null;
}

import { cookies } from 'next/headers';
import { SessionService, isAdminRole, type SessionContext } from '@ai-review/core';
import { db } from '../infra/db';
import { env } from '../infra/env';

/**
 * Session cookie plumbing (AUTH-02, SET-01, AC-002).
 *
 * 13_Security_Privacy_Compliance.md is specific about the shape: "Secure, HttpOnly, SameSite
 * session cookies; no auth token in localStorage". HttpOnly is what makes the token
 * unreachable from script, which is why the browser never sees it in JavaScript at all.
 *
 * SessionService (packages/core) owns the lifecycle and stores only the token's SHA-256; this
 * module owns the cookie and the request-side lookup.
 */

export const SESSION_COOKIE = () => env().SESSION_COOKIE_NAME;

export function sessionService(): SessionService {
  return new SessionService(db());
}

interface CookieOptions {
  httpOnly: true;
  secure: boolean;
  sameSite: 'lax';
  path: string;
  expires?: Date;
}

function cookieOptions(expires?: Date): CookieOptions {
  return {
    httpOnly: true,
    // Secure is unconditional in production. SameSite=Lax already blocks the cross-site form
    // POST that CSRF depends on; Secure is what stops the cookie crossing a plaintext hop.
    secure: env().NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    ...(expires ? { expires } : {}),
  };
}

/** Only callable from a Route Handler or Server Action — an RSC cannot write cookies. */
export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE(), token, cookieOptions(expiresAt));
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE(), '', cookieOptions(new Date(0)));
}

/**
 * Resolves the caller's session, or null.
 *
 * Never distinguishes expired from revoked from absent — all three are simply "no session", so
 * the response cannot be used to probe whether a token was ever valid.
 */
export async function getSession(): Promise<SessionContext | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE())?.value;
  if (!token) return null;

  return sessionService().resolve(token);
}

export type Role = SessionContext['role'];

/**
 * Where a role lands after authenticating (AUTH-02-03).
 *
 * A super-admin who signs in at /login belongs in the admin console, not a tenant dashboard,
 * and the two are separately guarded (RBAC rule 4). AMENDMENT-027: an admin role goes through
 * MFA first — enrolment if the account has none, the challenge otherwise — and only a session
 * that has passed it reaches /admin.
 */
export function nextPathAfterLogin(
  session: Pick<SessionContext, 'role' | 'mfaEnabledAt' | 'mfaVerifiedAt'>,
  mfaRequired = adminMfaRequired(),
): string {
  if (!isAdminRole(session.role)) return '/app';
  if (!mfaRequired) return '/admin';
  if (!session.mfaEnabledAt) return '/login/mfa/enrol';
  if (!session.mfaVerifiedAt) return '/login/mfa';
  return '/admin';
}

/** AMENDMENT-027's switch: false runs the admin area password-only. */
export function adminMfaRequired(): boolean {
  return env().ADMIN_MFA_REQUIRED;
}

/** The destination once every check has passed. */
export function landingPathFor(role: Role): string {
  return isAdminRole(role) ? '/admin' : '/app';
}

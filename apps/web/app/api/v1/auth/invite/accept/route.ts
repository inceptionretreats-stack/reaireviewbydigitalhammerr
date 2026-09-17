import { NextResponse, type NextRequest } from 'next/server';
import { inviteAcceptRequest } from '@ai-review/contracts';
import { MFA_PENDING_TTL_MS, privacyHash, validatePasswordStrength } from '@ai-review/core';
import { apiError } from '@/lib/api-error';
import { verifyCsrf } from '@/lib/csrf';
import { env } from '@/lib/env';
import { clientIp, isDenied, rateLimiter } from '@/lib/rate-limit';
import { getSession, sessionService, setSessionCookie } from '@/lib/session';
import { teamErrorResponse, teamService } from '@/lib/admin/team';
import { recordActivity } from '@/lib/activity';

export const runtime = 'nodejs';

/**
 * POST /api/v1/auth/invite/accept — the admin invitation link (AMENDMENT-027, Flow B's link).
 *
 * No session: the token is the credential, once. The password is held to the product's own
 * rules, the new account gets a pending admin session, and the answer sends them to enrol an
 * authenticator — an admin never reaches /admin on a password alone. Guessing tokens is
 * limited like a login, keyed on the token's hash rather than an identity.
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
  const parsed = inviteAcceptRequest.safeParse(raw);
  if (!parsed.success) {
    return apiError('VALIDATION_FAILED', 'Choose a password of at least 12 characters.', {
      details: { fields: ['password'] },
    });
  }
  const strength = validatePasswordStrength(parsed.data.password);
  if (!strength.ok) {
    return apiError('VALIDATION_FAILED', strength.reason, { details: { fields: ['password'] } });
  }

  const ip = clientIp(request);
  const pepper = env().HASH_PEPPER;
  const subject = {
    identifier: `invite:${parsed.data.token.slice(0, 16)}`,
    ip: ip ?? '0.0.0.0',
    pepper,
  };
  const limiter = rateLimiter();
  const gate = await limiter.loginAttempt(subject);
  if (isDenied(gate)) {
    return apiError('AUTH_RATE_LIMITED', 'Too many attempts. Please try again shortly.', {
      retryAfterSeconds: gate.retryAfterSeconds,
    });
  }

  let accepted;
  try {
    accepted = await teamService().acceptInvite({
      token: parsed.data.token,
      password: parsed.data.password,
    });
  } catch (error) {
    await limiter.loginFailure(subject);
    const response = teamErrorResponse(error);
    if (response) return response;
    throw error;
  }

  const existing = await getSession();
  if (existing) await sessionService().revoke(existing.sessionId, 'REPLACED_BY_LOGIN');

  const session = await sessionService().create({
    userId: accepted.userId,
    userAgent: request.headers.get('user-agent'),
    ipHash: ip ? privacyHash(ip, pepper) : null,
    ttlMs: MFA_PENDING_TTL_MS,
  });
  await setSessionCookie(session.token, session.expiresAt);
  recordActivity(
    request,
    { userId: accepted.userId },
    {
      action: 'auth.invite.accept',
      targetType: 'user',
      targetId: accepted.userId,
      metadata: { role: accepted.role },
    },
  );
  return NextResponse.json({ next: '/login/mfa/enrol', role: accepted.role });
}

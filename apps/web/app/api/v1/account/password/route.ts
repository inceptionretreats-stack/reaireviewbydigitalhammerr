import { NextResponse, type NextRequest } from 'next/server';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { passwordResetTokens, users } from '@ai-review/db';
import { privacyHash, SessionService, validatePasswordStrength } from '@ai-review/core';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { apiError } from '@/lib/api-error';
import { requireTenant } from '@/lib/require-tenant';
import { passwordHasher } from '@/lib/auth-helpers';
import { clientIp, isDenied, rateLimiter } from '@/lib/rate-limit';
import { setSessionCookie } from '@/lib/session';
import { bearerToken, mobileSessionBody } from '@/lib/mobile-client';
import { parsePasswordChange } from '../schema';
import { countOtherLiveSessions, reportableRevoked } from '../session-count';
import { recordActivity } from '@/lib/activity';
import { safeError } from '@/lib/safe-error';

/**
 * POST /api/v1/account/password — "Change password" on SET-01.
 *
 * SET-01-01 is the requirement that shapes this: the change requires the CURRENT password. Without
 * it, a stolen session is a permanent account takeover — the attacker sets a password the owner
 * does not know and the owner's own password stops working. Knowledge of the current password is
 * the one thing a session thief does not have.
 *
 * 13_Security_Privacy_Compliance.md requires the session to rotate on a password change, and
 * AMENDMENT-001 records that durable session rows exist precisely so it can. Both halves happen
 * below: every other session is revoked (SET-01-02) and the caller's own identifier is replaced,
 * so the token that was on the wire before the change cannot be replayed after it (AC-002's
 * fixation argument, applied to the other event that changes what a session is worth).
 *
 * The password itself is never logged, never placed in an error, and never returned (AUTH-01-03
 * applied here). Note that no branch below puts a password — old or new — into a message, and the
 * driver error is reduced to a fixed diagnostic label before it reaches the log: Drizzle's
 * message can itself contain statement parameters, including the new password hash.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireTenant(request);
  if (!auth.ok) return auth.response;
  const viaBearer = bearerToken(request.headers) !== null;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return apiError('VALIDATION_FAILED', 'Malformed request body.');
  }

  const parsed = parsePasswordChange(raw);
  if (!parsed.ok) {
    return apiError('VALIDATION_FAILED', parsed.message, { details: { fields: parsed.fields } });
  }

  const { currentPassword, newPassword } = parsed.value;
  const { userId, sessionId } = auth.context.session;
  const database = db();

  // deletedAt is already excluded by SessionService.resolve; re-stated because a row is about to be
  // written, and a closed account must not stay editable through a session that outlived it.
  const [account] = await database
    .select({ email: users.email, passwordHash: users.passwordHash })
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .limit(1);

  if (!account) return apiError('AUTH_REQUIRED', 'Please sign in and try again.');
  if (!account.passwordHash) {
    return apiError(
      'VALIDATION_FAILED',
      'This Google account has no password to change. Use password reset to set one first.',
      { details: { fields: ['current_password'] } },
    );
  }
  const currentPasswordHash = account.passwordHash;

  /*
   * The limiter, on the same windows as POST /auth/login.
   *
   * This endpoint verifies the same credential against the same account, so an unmetered version
   * of it is a password oracle sitting one route away from the one AC-002 protects — and a session
   * thief is exactly the caller who would use it. Sharing the window rather than adding a private
   * one is also what keeps the identity lockout meaningful: five wrong guesses is five, whichever
   * endpoint they arrive at.
   *
   * Inspected before any Argon2id work, as in login, so a locked-out identity never costs a
   * verification — that comparison is the expensive part of the request.
   *
   * The identifier is the STORED address, never anything from the body: the window has to be keyed
   * on the account whose credential is being guessed.
   */
  const limiter = rateLimiter();
  const ip = clientIp(request);
  const subject = { identifier: account.email, ip, pepper: env().HASH_PEPPER };

  const gate = await limiter.loginAttempt(subject);
  if (isDenied(gate)) {
    return apiError('AUTH_RATE_LIMITED', 'Too many attempts. Please try again shortly.', {
      retryAfterSeconds: gate.retryAfterSeconds,
      details: { fields: ['current_password'] },
    });
  }

  // Strength is checked before the current password is verified, for the reason
  // /auth/reset-password checks it before claiming its token: a request that cannot succeed should
  // not consume anything. validatePasswordStrength in @ai-review/core is authoritative for the
  // rules, and the messages below mirror the ones that endpoint returns for the same codes so an
  // owner is never told two different things about one rule.
  const strength = validatePasswordStrength(newPassword);
  if (!strength.ok) {
    return apiError('VALIDATION_FAILED', passwordMessage(strength.reason), {
      details: { fields: ['new_password'] },
    });
  }

  // A no-op change would still revoke every other session and rotate the cookie, which is a
  // confusing amount of consequence for a form that changed nothing. Compared as plaintext, which
  // costs nothing: both values are already in memory and neither is logged.
  if (newPassword === currentPassword) {
    return apiError('VALIDATION_FAILED', 'Choose a password different from your current one.', {
      details: { fields: ['new_password'] },
    });
  }

  const hasher = passwordHasher();
  const matches = await hasher.verify(currentPasswordHash, currentPassword);
  if (!matches) {
    const failure = await limiter.loginFailure(subject);
    // 401 / AUTH_INVALID_CREDENTIALS per 23_API_Error_Codes.md. The session is untouched: this
    // says the password was wrong, not that the caller is signed out.
    return apiError('AUTH_INVALID_CREDENTIALS', 'That password is not correct.', {
      details: { fields: ['current_password'] },
      ...(isDenied(failure) ? { retryAfterSeconds: failure.retryAfterSeconds } : {}),
    });
  }

  // A correct password forgives this account's earlier failures, exactly as a successful login
  // does, so a run of typos here cannot lock the owner out of the login screen.
  await limiter.loginSuccess(subject);

  const passwordHash = await hasher.hash(newPassword);

  let change: {
    rotated: { token: string; expiresAt: Date };
    signedOut: number;
  } | null;
  try {
    // All durable credential and session writes share a transaction. A failed sweep or rotation
    // must leave the old password and sessions intact, so the owner can retry safely.
    change = await database.transaction(async (tx) => {
      // The verified hash is a compare-and-swap guard against another credential change.
      const [changed] = await tx
        .update(users)
        .set({
          passwordHash,
          failedLoginCount: 0,
          lockedUntil: null,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(users.id, userId),
            eq(users.passwordHash, currentPasswordHash),
            isNull(users.deletedAt),
          ),
        )
        .returning({ id: users.id });
      if (!changed) return null;

      const liveBefore = await countOtherLiveSessions(tx, userId, sessionId);
      // A previously emailed reset link must not undo this credential change later.
      await tx
        .update(passwordResetTokens)
        .set({ usedAt: new Date() })
        .where(
          and(
            eq(passwordResetTokens.userId, userId),
            isNull(passwordResetTokens.usedAt),
            gt(passwordResetTokens.expiresAt, new Date()),
          ),
        );

      const service = new SessionService(tx);
      const revoked = await service.revokeAllForUser(userId, 'PASSWORD_CHANGED', sessionId);
      const rotated = await service.rotate(sessionId, {
        userId,
        userAgent: request.headers.get('user-agent'),
        ipHash: ip ? privacyHash(ip, env().HASH_PEPPER) : null,
        // The old session row does not record remember-me; use the shorter default lifetime for a
        // browser. The owner app is always remembered, as it was at sign-in.
        rememberMe: viaBearer,
      });
      return { rotated, signedOut: reportableRevoked(liveBefore, revoked) };
    });
  } catch (error) {
    console.error('[account] password change failed', safeError(error));
    return apiError('INTERNAL_ERROR', 'We could not change your password. Please try again.');
  }

  if (!change) {
    // The password moved under this request. Reported as a plain conflict rather than as a wrong
    // password, because the caller's input was right and retrying is the correct advice.
    return apiError('VALIDATION_FAILED', 'Your password was just changed elsewhere. Please retry.');
  }

  // Only browser cookie delivery remains after commit. Its failure cannot restore the old
  // password or old sessions; tell the owner to sign in with the new password in that case.
  // The owner app gets the rotated token in the body instead (lib/mobile-client.ts).
  let sessionRetained = true;
  if (!viaBearer) {
    try {
      await setSessionCookie(change.rotated.token, change.rotated.expiresAt);
    } catch (error) {
      sessionRetained = false;
      console.error('[account] password change cookie update failed', safeError(error));
    }
  }

  recordActivity(
    request,
    { session: auth.context.session, businessId: auth.context.businessId },
    {
      action: 'auth.password.change',
      targetType: 'user',
      targetId: userId,
      metadata: { other_sessions_signed_out: change.signedOut },
    },
  );
  return NextResponse.json({
    message: sessionRetained
      ? 'Your password has been changed.'
      : 'Your password has been changed. Please sign in again with your new password.',
    other_sessions_signed_out: change.signedOut,
    sessions_swept: true,
    session_retained: sessionRetained,
    ...(viaBearer ? { session: mobileSessionBody(change.rotated) } : {}),
  });
}

/** Mirrors the wording /auth/reset-password returns for the same rejection codes. */
function passwordMessage(reason: string): string {
  switch (reason) {
    case 'TOO_SHORT':
      return 'Use at least 12 characters.';
    case 'TOO_LONG':
      return 'That password is too long.';
    case 'TOO_COMMON':
      return 'That password is too easy to guess. Please choose another.';
    default:
      return 'Use a mix of at least five different characters.';
  }
}

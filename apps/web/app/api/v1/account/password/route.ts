import { NextResponse, type NextRequest } from 'next/server';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { users } from '@ai-review/db';
import { privacyHash, validatePasswordStrength } from '@ai-review/core';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { apiError } from '@/lib/api-error';
import { requireTenant } from '@/lib/require-tenant';
import { passwordHasher } from '@/lib/auth-helpers';
import { clientIp, isDenied, rateLimiter } from '@/lib/rate-limit';
import { sessionService, setSessionCookie } from '@/lib/session';
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
  const matches = await hasher.verify(account.passwordHash, currentPassword);
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

  let changed: { id: string }[];
  try {
    /*
     * A conditional UPDATE, not a plain one: the WHERE still carries the hash that was just
     * verified, so if a concurrent request changed the password in between, this one affects no
     * rows instead of overwriting a change it never saw. Same reasoning as the single-use claim in
     * /auth/reset-password — the check and the write have to be one step to mean anything.
     */
    changed = await database
      .update(users)
      .set({
        passwordHash,
        // A password change is also the recovery path for an account that locked itself out with
        // failed logins, and the owner has just proved they hold the credential.
        failedLoginCount: 0,
        lockedUntil: null,
        updatedAt: sql`now()`,
      })
      .where(and(eq(users.id, userId), eq(users.passwordHash, account.passwordHash)))
      .returning({ id: users.id });
  } catch (error) {
    console.error('[account] password change failed', safeError(error));
    return apiError('INTERNAL_ERROR', 'We could not change your password. Please try again.');
  }

  if (changed.length === 0) {
    // The password moved under this request. Reported as a plain conflict rather than as a wrong
    // password, because the caller's input was right and retrying is the correct advice.
    return apiError('VALIDATION_FAILED', 'Your password was just changed elsewhere. Please retry.');
  }

  /*
   * Order matters, and it is: sweep, then rotate.
   *
   * `revokeAllForUser` excepts the CURRENT session id, so this revokes every other session while
   * leaving the caller signed in. Rotating first would create a new session that the sweep could
   * not except — `rotate` returns a token, not an id — and the owner would be signed out of the
   * browser they just changed their password in.
   *
   * `rotate` then issues a fresh identifier and revokes the one that carried this request, so a
   * token captured before the change cannot be used after it. Cookies are writable here because
   * this is a route handler; a Server Component could not do this half.
   *
   * Guarded, because the password is already committed above.
   *
   * Everything from here on is post-commit work, and an unguarded throw would leave Next to answer
   * a bare 500 — which `use-settings-submit.ts` cannot parse, so it reports `NETWORK`, "Could not
   * reach the server". The owner would be told the change failed while their new password is the
   * one that works, and would then try the old one at /login and be refused. A 200 that says what
   * did and did not happen is the only honest answer once the credential has been replaced, and it
   * is why the sibling sweep in sessions/revoke-others/route.ts is wrapped too.
   *
   * Null means the sweep or the rotation did not complete. It is not narrowed further on purpose:
   * `rotate` creates the new row before revoking the old one, so a throw inside it can leave either
   * one or two sessions live, and the response must not imply a precision the state does not have.
   */
  let sweep: { signedOut: number } | null = null;
  try {
    const service = sessionService();
    const liveBefore = await countOtherLiveSessions(database, userId, sessionId);
    const revoked = await service.revokeAllForUser(userId, 'PASSWORD_CHANGED', sessionId);

    const rotated = await service.rotate(sessionId, {
      userId,
      userAgent: request.headers.get('user-agent'),
      /*
       * A privacy-preserving hash, never the address itself. `sessions.ip_hash` is char(64) —
       * sized for a SHA-256 digest — and 13_Security_Privacy_Compliance.md requires
       * privacy-preserving hashes rather than a raw IP retained for the 30-day life of a session
       * row. `privacyHash` is the same function `packages/core/src/rate-limit/policies.ts` uses,
       * so one address produces one value across the system.
       */
      ipHash: ip ? privacyHash(ip, env().HASH_PEPPER) : null,
      // Deliberately not carried over from the old session. `sessions` stores no "remember me"
      // flag, so it cannot be read back; defaulting to the shorter lifetime is the safer of the
      // two guesses, and the cost of guessing wrong is one sign-in.
    });
    await setSessionCookie(rotated.token, rotated.expiresAt);

    sweep = { signedOut: reportableRevoked(liveBefore, revoked) };
  } catch (error) {
    // AC-030: never log a statement message or its parameters, which may include the new hash.
    console.error('[account] session sweep after password change failed', safeError(error));
  }

  recordActivity(
    request,
    { session: auth.context.session, businessId: auth.context.businessId },
    {
      action: 'auth.password.change',
      targetType: 'user',
      targetId: userId,
      metadata: { other_sessions_signed_out: sweep?.signedOut ?? 0 },
    },
  );
  return NextResponse.json({
    message: sweep
      ? 'Your password has been changed.'
      : 'Your password has been changed, but we could not sign out your other sessions.',
    // SET-01-02: the sweep has to have visible effect, and this is that effect for the sessions
    // the owner cannot see. See ../session-count.ts for why this is not the raw revoked-row count.
    other_sessions_signed_out: sweep?.signedOut ?? 0,
    /*
     * Whether the sweep actually ran, so the screen can drop its "every other session was signed
     * out, and you are still signed in here" sentence instead of asserting it on faith. Reported
     * positively — an older client reading a missing field as false errs towards telling the owner
     * to sweep again, which is the harmless direction.
     */
    sessions_swept: sweep !== null,
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

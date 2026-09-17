import { NextResponse, type NextRequest } from 'next/server';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { passwordResetTokens, users } from '@ai-review/db';
import { hashToken, validatePasswordStrength } from '@ai-review/core';
import { resetPasswordRequest } from '@ai-review/contracts';
import { db } from '@/lib/db';
import { apiError } from '@/lib/api-error';
import { verifyCsrf } from '@/lib/csrf';
import { passwordHasher } from '@/lib/auth-helpers';
import { clearSessionCookie, sessionService } from '@/lib/session';
import { recordActivity } from '@/lib/activity';

/**
 * POST /api/v1/auth/reset-password — AUTH-03-02.
 *
 * This endpoint is absent from 08_OpenAPI_v1.yaml, which defines /auth/forgot-password with no
 * counterpart to consume the token it issues. Recorded as OPEN-03 in docs/SPEC_AMENDMENTS.md;
 * AUTH-03-02 requires the token be single-use and expiring, which is unimplementable without it.
 *
 * "Single-use" is enforced by an atomic conditional UPDATE, not by a read followed by a write.
 * The distinction is the whole guarantee: two requests arriving together with the same leaked
 * token would both read used_at IS NULL, both proceed, and the token would have been used twice.
 * Claiming the token by UPDATE ... WHERE used_at IS NULL RETURNING means exactly one wins.
 *
 * Every failure returns the same message. A response distinguishing expired from already-used
 * from never-existed tells someone holding a stale link which of those it is, which is
 * information about the account rather than about their request.
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

  const parsed = resetPasswordRequest.safeParse(raw);
  if (!parsed.success) {
    return apiError('VALIDATION_FAILED', 'Choose a password of at least 12 characters.', {
      details: { fields: ['password'] },
    });
  }

  const { token, password } = parsed.data;

  // Checked before the token is claimed, so a weak password does not burn the user's one use
  // and force them to request a second email.
  const strength = validatePasswordStrength(password);
  if (!strength.ok) {
    return apiError('VALIDATION_FAILED', passwordMessage(strength.reason), {
      details: { fields: ['password'] },
    });
  }

  const database = db();
  const passwordHash = await passwordHasher().hash(password);

  // The claim and the password change are one transaction: a token consumed without the password
  // actually changing would leave the user locked out with a spent link.
  const userId = await database.transaction(async (tx) => {
    const claimed = await tx
      .update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(passwordResetTokens.tokenHash, hashToken(token)),
          isNull(passwordResetTokens.usedAt),
          gt(passwordResetTokens.expiresAt, new Date()),
        ),
      )
      .returning({ userId: passwordResetTokens.userId });

    const row = claimed[0];
    if (!row) return null;

    await tx
      .update(users)
      .set({
        passwordHash,
        // A reset is also the recovery path for a locked-out account, so the lock is lifted.
        failedLoginCount: 0,
        lockedUntil: null,
        updatedAt: sql`now()`,
      })
      .where(eq(users.id, row.userId));

    return row.userId;
  });

  if (!userId) {
    return apiError(
      'VALIDATION_FAILED',
      'That reset link is no longer valid. Please request a new one.',
    );
  }

  // 13_Security_Privacy_Compliance.md: rotate sessions on password reset. Every existing session
  // is revoked, including the caller's own — if the reason for resetting was that someone else
  // had access, leaving their session live defeats the point.
  await sessionService().revokeAllForUser(userId, 'PASSWORD_RESET');
  await clearSessionCookie();

  recordActivity(
    request,
    { userId },
    { action: 'auth.password.reset.complete', targetType: 'user', targetId: userId },
  );
  return NextResponse.json({
    message: 'Your password has been changed. Please sign in.',
    next: '/login',
  });
}

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

import { NextResponse, type NextRequest } from 'next/server';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { passwordResetTokens, users } from '@ai-review/db';
import { hashToken, SessionService, validatePasswordStrength } from '@ai-review/core';
import { resetPasswordRequest } from '@ai-review/contracts';
import { db } from '@/lib/infra/db';
import { apiError } from '@/lib/http/api-error';
import { readJsonObject } from '@/lib/http/request-body';
import { verifyCsrf } from '@/lib/http/csrf';
import { passwordHasher } from '@/lib/auth/helpers';
import { clearSessionCookie } from '@/lib/auth/session';
import { recordActivity } from '@/lib/activity/recorder';
import { safeError } from '@/lib/infra/safe-error';

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

  const rawResult = await readJsonObject(request);
  if (!rawResult.ok) return rawResult.response;
  const raw = rawResult.body;

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

  let userId: string | null;
  try {
    const database = db();
    const tokenHash = hashToken(token);

    // Reject unknown, expired or spent links before expensive Argon2 work. This is only an
    // optimization: the conditional UPDATE below must still re-check all three conditions,
    // because the link can expire or be claimed while hashing is in progress.
    const [candidate] = await database
      .select({ id: passwordResetTokens.id })
      .from(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.tokenHash, tokenHash),
          isNull(passwordResetTokens.usedAt),
          gt(passwordResetTokens.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (!candidate) return invalidLink();

    const passwordHash = await passwordHasher().hash(password);

    // Token claim, password change and revocation are one security boundary. If any write
    // fails, the transaction restores the old password and leaves the link usable for a retry.
    // In particular, never commit a new password while another device's old session stays live.
    userId = await database.transaction(async (tx) => {
      const claimed = await tx
        .update(passwordResetTokens)
        .set({ usedAt: new Date() })
        .where(
          and(
            eq(passwordResetTokens.tokenHash, tokenHash),
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

      // Use the transaction executor, NOT the process-wide session service/connection.
      await new SessionService(tx).revokeAllForUser(row.userId, 'PASSWORD_RESET');
      return row.userId;
    });
  } catch (error) {
    console.error('[auth] password reset failed', safeError(error));
    return apiError('INTERNAL_ERROR', 'We could not change your password. Please try again.');
  }

  if (!userId) return invalidLink();

  try {
    await clearSessionCookie();
  } catch (error) {
    // The password is already changed and every old session is revoked in the database.
    // A stale browser cookie has no authority; do not falsely report a failed password change.
    console.error('[auth] reset cookie cleanup failed after password change', safeError(error));
  }

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

function invalidLink(): NextResponse {
  return apiError(
    'VALIDATION_FAILED',
    'That reset link is no longer valid. Please request a new one.',
  );
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

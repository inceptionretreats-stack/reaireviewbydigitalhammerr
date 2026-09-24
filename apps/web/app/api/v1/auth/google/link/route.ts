import { NextResponse, type NextRequest } from 'next/server';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { googleIdentities, users } from '@ai-review/db';
import { z } from 'zod';
import { apiError } from '@/lib/http/api-error';
import { readJsonObject } from '@/lib/http/request-body';
import { db } from '@/lib/infra/db';
import { env } from '@/lib/infra/env';
import { verifyCsrf } from '@/lib/http/csrf';
import { passwordHasher } from '@/lib/auth/helpers';
import { clearGooglePending, readGooglePending } from '@/lib/auth/google-auth';
import { signInGoogleVendor } from '@/lib/auth/google-auth-session';
import { clientIp, isDenied, rateLimiter } from '@/lib/http/rate-limit';
import { recordActivity } from '@/lib/activity/recorder';
import { isUniqueViolation, safeError } from '@/lib/infra/safe-error';

const linkRequest = z.object({
  flow_id: z.string().regex(/^[A-Za-z0-9_-]{32}$/),
  password: z.string().min(1).max(256),
});

/** Link an existing password vendor only after a fresh password proof. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!verifyCsrf(request).ok) return apiError('FORBIDDEN', 'Request rejected.');
  const pending = await readGooglePending();
  if (!pending || pending.flow !== 'link') {
    return apiError('AUTH_REQUIRED', 'Google sign-in expired. Please try again.');
  }

  const rawResult = await readJsonObject(request);
  if (!rawResult.ok) return rawResult.response;
  const raw = rawResult.body;
  const parsed = linkRequest.safeParse(raw);
  if (!parsed.success) {
    return apiError('VALIDATION_FAILED', 'Enter your account password.', {
      details: { fields: ['password'] },
    });
  }
  if (parsed.data.flow_id !== pending.flowId) {
    return apiError('AUTH_REQUIRED', 'Google sign-in changed. Please start again.');
  }

  const ip = clientIp(request);
  const subject = { identifier: pending.email, ip, pepper: env().HASH_PEPPER };
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
      disabledAt: users.disabledAt,
      lockedUntil: users.lockedUntil,
    })
    .from(users)
    .where(and(eq(users.email, pending.email), isNull(users.deletedAt)))
    .limit(1);

  const validAccount =
    account?.role === 'BUSINESS_OWNER' &&
    !account.disabledAt &&
    !(account.lockedUntil && account.lockedUntil > new Date()) &&
    Boolean(account.passwordHash);
  const matches = validAccount
    ? await passwordHasher().verify(account.passwordHash!, parsed.data.password)
    : false;
  if (!matches || !account?.passwordHash) {
    const failure = await limiter.loginFailure(subject);
    return apiError('AUTH_INVALID_CREDENTIALS', 'That password is not correct.', {
      details: { fields: ['password'] },
      ...(isDenied(failure) ? { retryAfterSeconds: failure.retryAfterSeconds } : {}),
    });
  }

  try {
    const linked = await database.transaction(async (tx) => {
      // Conditional update obtains a row lock and ensures no concurrent password change has
      // invalidated the just-verified proof before the Google subject is linked.
      const [stillAuthorized] = await tx
        .update(users)
        .set({ updatedAt: sql`now()` })
        .where(
          and(
            eq(users.id, account.id),
            eq(users.passwordHash, account.passwordHash!),
            isNull(users.deletedAt),
            isNull(users.disabledAt),
          ),
        )
        .returning({ id: users.id });
      if (!stillAuthorized) return false;

      await tx.insert(googleIdentities).values({
        userId: account.id,
        googleSubject: pending.sub,
      });
      return true;
    });
    if (!linked) {
      return apiError(
        'AUTH_INVALID_CREDENTIALS',
        'Your account changed. Please start Google sign-in again.',
      );
    }
  } catch (error) {
    if (isUniqueViolation(error)) {
      await clearGooglePending();
      return apiError(
        'VALIDATION_FAILED',
        'This account is already linked to Google. Please sign in again.',
      );
    }
    console.error('[auth] Google account link failed', safeError(error));
    return apiError('INTERNAL_ERROR', 'We could not link your account. Please try again.');
  }

  await clearGooglePending();
  await limiter.loginSuccess(subject);
  recordActivity(
    request,
    { userId: account.id },
    { action: 'auth.login', metadata: { provider: 'google', account_linked: true } },
  );

  try {
    await signInGoogleVendor(request, account.id);
  } catch (error) {
    console.error('[auth] Google link session failed after linking', safeError(error));
    return apiError(
      'INTERNAL_ERROR',
      'Google was linked, but we could not sign you in. Please use Continue with Google again.',
      { details: { account_linked: true, next: '/login' } },
    );
  }
  return NextResponse.json({ next: '/app' }, { headers: { 'Cache-Control': 'no-store' } });
}

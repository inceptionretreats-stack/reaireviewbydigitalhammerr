import { NextResponse, type NextRequest } from 'next/server';
import { and, eq, isNull } from 'drizzle-orm';
import { googleIdentities, users } from '@ai-review/db';
import { z } from 'zod';
import { apiError } from '@/lib/api-error';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { verifyCsrf } from '@/lib/csrf';
import { consumeGoogleChallenge, setGooglePending, verifyGoogleCredential } from '@/lib/google-auth';
import { signInGoogleVendor } from '@/lib/google-auth-session';
import { clientIp, isDenied, rateLimiter } from '@/lib/rate-limit';
import { recordActivity } from '@/lib/activity';
import { safeError } from '@/lib/safe-error';

const credentialRequest = z.object({ credential: z.string().min(100).max(8192) });

/** GIS popup callback posts its ID token here from same-origin JavaScript. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!verifyCsrf(request).ok) return apiError('FORBIDDEN', 'Request rejected.');
  if (!env().GOOGLE_CLIENT_ID) {
    return apiError('AUTH_PROVIDER_UNAVAILABLE', 'Google sign-in is not configured yet.');
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return apiError('VALIDATION_FAILED', 'Malformed request body.');
  }
  const parsed = credentialRequest.safeParse(raw);
  if (!parsed.success) return apiError('VALIDATION_FAILED', 'Google sign-in response is invalid.');

  const nonce = await consumeGoogleChallenge();
  if (!nonce) {
    return apiError('AUTH_INVALID_CREDENTIALS', 'Google sign-in expired. Please try again.');
  }

  // Use the nonce as a bounded identity window for malformed credentials. The shared IP-prefix
  // limit still protects against a caller fetching fresh nonces for each attempt.
  const subject = { identifier: `google:${nonce}`, ip: clientIp(request), pepper: env().HASH_PEPPER };
  const limiter = rateLimiter();
  const gate = await limiter.loginAttempt(subject);
  if (isDenied(gate)) {
    return apiError('AUTH_RATE_LIMITED', 'Too many sign-in attempts. Please try again shortly.', {
      retryAfterSeconds: gate.retryAfterSeconds,
    });
  }

  const identity = await verifyGoogleCredential(parsed.data.credential, nonce);
  if (!identity) {
    const failure = await limiter.loginFailure(subject);
    return apiError('AUTH_INVALID_CREDENTIALS', 'Google sign-in could not be verified. Please try again.', {
      ...(isDenied(failure) ? { retryAfterSeconds: failure.retryAfterSeconds } : {}),
    });
  }

  try {
    const database = db();
    const [mapped] = await database
      .select({
        userId: users.id,
        role: users.role,
        disabledAt: users.disabledAt,
        deletedAt: users.deletedAt,
        lockedUntil: users.lockedUntil,
      })
      .from(googleIdentities)
      .innerJoin(users, eq(googleIdentities.userId, users.id))
      .where(eq(googleIdentities.googleSubject, identity.sub))
      .limit(1);

    if (mapped) {
      // Google is deliberately a vendor-only path. Admins must use password + MFA.
      if (
        mapped.role !== 'BUSINESS_OWNER' ||
        mapped.disabledAt ||
        mapped.deletedAt ||
        (mapped.lockedUntil && mapped.lockedUntil > new Date())
      ) {
        return apiError('AUTH_INVALID_CREDENTIALS', 'This account cannot sign in with Google.');
      }
      await signInGoogleVendor(request, mapped.userId);
      recordActivity(request, { userId: mapped.userId }, { action: 'auth.login', metadata: { provider: 'google' } });
      return NextResponse.json({ next: '/app' }, { headers: { 'Cache-Control': 'no-store' } });
    }

    const [existing] = await database
      .select({
        id: users.id,
        role: users.role,
        passwordHash: users.passwordHash,
        disabledAt: users.disabledAt,
      })
      .from(users)
      .where(and(eq(users.email, identity.email), isNull(users.deletedAt)))
      .limit(1);

    if (existing && (existing.role !== 'BUSINESS_OWNER' || existing.disabledAt || !existing.passwordHash)) {
      return apiError(
        'AUTH_INVALID_CREDENTIALS',
        'This email is already associated with another account. Use its original sign-in method.',
      );
    }

    const flow = existing ? 'link' : 'signup';
    await setGooglePending({
      sub: identity.sub,
      email: identity.email,
      fullName: identity.fullName,
      flow,
      authoritativeEmail: identity.authoritativeEmail,
    });
    return NextResponse.json(
      { next: '/signup/google' },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('[auth] Google sign-in failed', safeError(error));
    return apiError('INTERNAL_ERROR', 'Google sign-in is unavailable. Please try again.');
  }
}

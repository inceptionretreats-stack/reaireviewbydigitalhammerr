import { NextResponse, type NextRequest } from 'next/server';
import { businesses, subscriptions, users } from '@ai-review/db';
import {
  normalizePhone,
  PlatformSettingsService,
  privacyHash,
  validatePasswordStrength,
} from '@ai-review/core';
import { signupRequest } from '@ai-review/contracts';
import { db } from '@/lib/infra/db';
import { env } from '@/lib/infra/env';
import { apiError } from '@/lib/http/api-error';
import { readJsonObject } from '@/lib/http/request-body';
import { verifyCsrf } from '@/lib/http/csrf';
import { passwordHasher } from '@/lib/auth/password-hasher';
import { SHELL_CATEGORY, shellBusinessName } from '@/lib/tenant/tenant-shell';
import { landingPathFor, sessionService, setSessionCookie } from '@/lib/auth/session';
import { clientIp, isDenied, rateLimiter } from '@/lib/http/rate-limit';
import { recordActivity } from '@/lib/activity/recorder';
import { isUniqueViolation, safeError } from '@/lib/infra/safe-error';

/**
 * POST /api/v1/auth/signup — AUTH-01.
 *
 * AC-001 is the constraint that shapes this: invalid input must be rejected "without creating
 * partial active tenants". A user row without its subscription, or a business without an owner,
 * is exactly that partial state — so all three rows are written in one transaction and any
 * failure leaves nothing behind.
 *
 * AUTH-01-03: the password is never logged. It is read from the parsed body, hashed, and never
 * placed in an error, an event or a log line. Note that the Zod issues below are mapped to
 * field names only, never to the values that failed.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const csrf = verifyCsrf(request);
  if (!csrf.ok) return apiError('FORBIDDEN', 'Request rejected.');

  // AUTH-01, before the body is even read. This endpoint had no limit at all: 25 rejections
  // came back in 1.5 s, each confirming whether an address already has an account — an
  // enumeration oracle that works against the platform's own admin addresses — and six real
  // tenants, each with a fresh free draft allowance, were created in 428 ms. The "that email
  // already exists" answer is required by AUTH-01 and cannot be made neutral, so the rate of
  // asking is what has to be bounded.
  const gate = await rateLimiter().signup({ ip: clientIp(request), pepper: env().HASH_PEPPER });
  if (isDenied(gate)) {
    return apiError('AUTH_RATE_LIMITED', 'Too many sign-up attempts. Please try again later.', {
      retryAfterSeconds: gate.retryAfterSeconds,
    });
  }

  const rawResult = await readJsonObject(request);
  if (!rawResult.ok) return rawResult.response;
  const raw = rawResult.body;

  const parsed = signupRequest.safeParse(raw);
  if (!parsed.success) {
    return apiError('VALIDATION_FAILED', 'Please check the details you entered.', {
      details: { fields: fieldNames(parsed.error.issues) },
    });
  }

  const { full_name: fullName, email, mobile, password } = parsed.data;

  const strength = validatePasswordStrength(password);
  if (!strength.ok) {
    return apiError('VALIDATION_FAILED', passwordMessage(strength.reason), {
      details: { fields: ['password'] },
    });
  }

  const phone = normalizePhone(mobile);
  if (!phone.ok) {
    return apiError('VALIDATION_FAILED', 'Enter a valid 10-digit mobile number.', {
      details: { fields: ['mobile'] },
    });
  }

  let userId: string;
  try {
    const passwordHash = await passwordHasher().hash(password);
    const database = db();
    const commercial = await new PlatformSettingsService(database).values();

    userId = await database.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({
          email,
          mobile: phone.e164,
          fullName,
          passwordHash,
          role: 'BUSINESS_OWNER',
        })
        .returning({ id: users.id });

      if (!user) throw new Error('user insert returned no row');

      // The shell tenant (AUTH-01-01). DRAFT, so no public surface will serve it, and carrying
      // placeholder identity until ONB-01 supplies the real values.
      const [business] = await tx
        .insert(businesses)
        .values({
          ownerUserId: user.id,
          name: shellBusinessName(fullName),
          category: SHELL_CATEGORY,
          status: 'DRAFT',
          timezone: env().DEFAULT_TIMEZONE,
        })
        .returning({ id: businesses.id });

      if (!business) throw new Error('business insert returned no row');

      // Created here rather than lazily so that entitlement is never absent for a live tenant.
      // The numbers come from platform_settings (ADMIN-04), read once above, so a change an
      // admin makes applies to the next signup without a deploy. The environment's values are
      // no longer consulted here; the settings service carries the spec defaults itself.
      await tx.insert(subscriptions).values({
        businessId: business.id,
        status: 'FREE',
        freeGenerationLimit: commercial.free_generation_limit,
        proGenerationLimit: commercial.pro_generation_limit,
        amountPaise: commercial.annual_price_paise,
      });

      return user.id;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      // AUTH-01 lists an explicit "email exists" state, so this is the sanctioned disclosure
      // rather than a leak — a signup form cannot function without telling you the address is
      // taken. The neutral-response requirement belongs to forgot-password (AUTH-03-01).
      return apiError('VALIDATION_FAILED', 'An account with that email already exists.', {
        details: { fields: ['email'] },
      });
    }
    console.error('[auth] signup failed', safeError(error));
    return apiError('INTERNAL_ERROR', 'We could not create your account. Please try again.');
  }

  // Hashed, not raw. 13_Security_Privacy_Compliance.md forbids retaining a raw IP, the column
  // is a char(64) digest, and the login and password-change routes both hash it — signup writing
  // the plain address left the same column holding two different kinds of value.
  recordActivity(
    request,
    { userId },
    { action: 'auth.signup', targetType: 'user', targetId: userId },
  );

  try {
    const signupIp = clientIp(request);
    const session = await sessionService().create({
      userId,
      userAgent: request.headers.get('user-agent'),
      ipHash: signupIp ? privacyHash(signupIp, env().HASH_PEPPER) : null,
    });
    await setSessionCookie(session.token, session.expiresAt);
  } catch (error) {
    // The user, business and subscription are already committed. Do not say creation failed or
    // delete them: the owner can sign in with the password they just chose once sessions recover.
    console.error('[auth] signup session failed after account creation', safeError(error));
    return apiError(
      'INTERNAL_ERROR',
      'Your account was created, but we could not sign you in. Please sign in with your new account.',
      { details: { account_created: true, next: '/login' } },
    );
  }
  return NextResponse.json(
    { next: landingPathFor('BUSINESS_OWNER'), onboarding_required: true },
    { status: 201 },
  );
}

function fieldNames(issues: readonly { path: readonly (string | number | symbol)[] }[]): string[] {
  return [...new Set(issues.map((issue) => String(issue.path[0] ?? 'body')))];
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

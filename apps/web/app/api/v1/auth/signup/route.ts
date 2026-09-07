import { NextResponse, type NextRequest } from 'next/server';
import { businesses, subscriptions, users } from '@ai-review/db';
import { normalizePhone, privacyHash, validatePasswordStrength } from '@ai-review/core';
import { signupRequest } from '@ai-review/contracts';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { apiError } from '@/lib/api-error';
import { verifyCsrf } from '@/lib/csrf';
import { passwordHasher, SHELL_CATEGORY, shellBusinessName } from '@/lib/auth-helpers';
import { landingPathFor, sessionService, setSessionCookie } from '@/lib/session';
import { clientIp } from '@/lib/rate-limit';

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

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return apiError('VALIDATION_FAILED', 'Malformed request body.');
  }

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

  const passwordHash = await passwordHasher().hash(password);
  const database = db();

  let userId: string;
  try {
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
      // The free limit comes from config only as a bootstrap; ADMIN-04 makes the database
      // authoritative once platform_settings is seeded.
      await tx.insert(subscriptions).values({
        businessId: business.id,
        status: 'FREE',
        freeGenerationLimit: env().FREE_AI_GENERATION_LIMIT,
        amountPaise: env().PRO_ANNUAL_PRICE_PAISE,
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
    console.error('[auth] signup failed', redactError(error));
    return apiError('INTERNAL_ERROR', 'We could not create your account. Please try again.');
  }

  // Hashed, not raw. 13_Security_Privacy_Compliance.md forbids retaining a raw IP, the column
  // is a char(64) digest, and the login and password-change routes both hash it — signup writing
  // the plain address left the same column holding two different kinds of value.
  const signupIp = clientIp(request);
  const session = await sessionService().create({
    userId,
    userAgent: request.headers.get('user-agent'),
    ipHash: signupIp ? privacyHash(signupIp, env().HASH_PEPPER) : null,
  });
  await setSessionCookie(session.token, session.expiresAt);

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

/** 23505 is Postgres unique_violation; only users.email is unique in this transaction. */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

/**
 * Keeps a driver error out of the log verbatim.
 *
 * node-postgres attaches the failing statement parameters to some errors, and one of those
 * parameters is the password hash. AC-030 and AUTH-01-03 both make that unacceptable.
 */
function redactError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return 'unknown error';
}

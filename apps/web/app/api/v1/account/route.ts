import { NextResponse, type NextRequest } from 'next/server';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { users } from '@ai-review/db';
import { normalizePhone } from '@ai-review/core';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { apiError } from '@/lib/api-error';
import { readJsonObject } from '@/lib/request-body';
import { requireTenant } from '@/lib/require-tenant';
import { passwordHasher } from '@/lib/auth-helpers';
import { clientIp, isDenied, rateLimiter } from '@/lib/rate-limit';
import { emailChanged, parseAccountDetails } from './schema';
import { recordActivity } from '@/lib/activity';
import { isUniqueViolation, safeError } from '@/lib/safe-error';

/**
 * PATCH /api/v1/account — the account half of SET-01.
 *
 * The identity is never taken from the request. `requireTenant` verifies CSRF, resolves the
 * session and hands back the caller's own `userId`; there is no user id or business id in the URL
 * or body for anyone to tamper with, so the IDOR shape AC-003 tests for cannot be expressed here
 * (RBAC rule 2).
 *
 * `requireActiveTenant` is deliberately NOT applied, unlike the business-configuration routes.
 * Flow J restricts a suspended or closed tenant from mutating its *business* configuration; the
 * owner's own name, email and password are not that, and an owner whose business has been
 * suspended still needs to be able to correct their contact details and secure their account.
 *
 * SET-01-01, "sensitive changes require re-auth where appropriate", is read here as: an email
 * change does, a name or mobile change does not. The distinction is what the change buys an
 * attacker holding a stolen session. Their own address on the account is the first step of a
 * silent takeover — it is where a future password-reset link goes — so it costs them the current
 * password, which a session thief does not have. A name or a mobile grants no such foothold, and
 * demanding a password for a typo fix teaches owners to type it whenever they are asked.
 */
export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const auth = await requireTenant(request);
  if (!auth.ok) return auth.response;

  const rawResult = await readJsonObject(request);
  if (!rawResult.ok) return rawResult.response;
  const raw = rawResult.body;

  const parsed = parseAccountDetails(raw);
  if (!parsed.ok) {
    return apiError('VALIDATION_FAILED', parsed.message, { details: { fields: parsed.fields } });
  }

  const { userId } = auth.context.session;
  const database = db();

  // deletedAt is already excluded by SessionService.resolve. Re-stated because this row is about
  // to be written: a closed account must not stay editable through a session that outlived it.
  const [account] = await database
    .select({
      email: users.email,
      passwordHash: users.passwordHash,
      emailVerifiedAt: users.emailVerifiedAt,
    })
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .limit(1);

  if (!account) return apiError('AUTH_REQUIRED', 'Please sign in and try again.');

  const details = parsed.value;
  const changingEmail = emailChanged(details.email, account.email);

  if (changingEmail) {
    if (!account.passwordHash) {
      return apiError(
        'VALIDATION_FAILED',
        'Set an account password through password reset before changing your email.',
        { details: { fields: ['current_password'] } },
      );
    }
    if (details.currentPassword === null) {
      return apiError('VALIDATION_FAILED', 'Enter your current password to change your email.', {
        details: { fields: ['current_password'] },
      });
    }

    const rejection = await verifyCurrentPassword({
      request,
      email: account.email,
      passwordHash: account.passwordHash,
      candidate: details.currentPassword,
    });
    if (rejection !== null) return rejection;
  }

  const phone = normalizePhone(details.mobile);
  if (!phone.ok) {
    return apiError('VALIDATION_FAILED', 'Enter a valid 10-digit mobile number.', {
      details: { fields: ['mobile'] },
    });
  }

  /*
   * A changed address clears email_verified_at.
   *
   * The column is a claim that *this* address was proved to belong to the account holder, and the
   * new one has been proved by nobody — carrying the timestamp across would mark an unproven
   * address verified, and anything later gated on verification (Flow B invites, notifications, a
   * recovery check) would then trust it. Nothing in V1 reads the column and no flow re-verifies an
   * address, so for the accounts that have it set — seeded and admin-created users — this is a
   * one-way downgrade. That is the honest state rather than the comfortable one, and it is not
   * silent: the response says so and the screen turns it into a sentence. See concerns.
   */
  try {
    await database
      .update(users)
      .set({
        fullName: details.fullName,
        email: details.email,
        mobile: phone.e164,
        ...(changingEmail ? { emailVerifiedAt: null } : {}),
        updatedAt: sql`now()`,
      })
      .where(eq(users.id, userId));
  } catch (error) {
    if (isUniqueViolation(error)) {
      // users.email is the only unique column this statement touches. The owner has to be told the
      // address is taken or the form cannot be completed; the neutral-response rule belongs to
      // forgot-password (AUTH-03-01), not to a form its account holder is already signed into.
      return apiError('VALIDATION_FAILED', 'An account with that email already exists.', {
        details: { fields: ['email'] },
      });
    }
    // Driver/ORM messages can include statement parameters, including the email address.
    console.error('[account] details update failed', safeError(error));
    return apiError('INTERNAL_ERROR', 'We could not save your details. Please try again.');
  }

  recordActivity(
    request,
    { session: auth.context.session, businessId: auth.context.businessId },
    {
      action: 'account.update',
      targetType: 'user',
      targetId: userId,
      metadata: { email_changed: details.email !== account.email },
    },
  );
  return NextResponse.json({
    full_name: details.fullName,
    email: details.email,
    mobile: phone.e164,
    /*
     * Reported on purpose: this is what stops the verification downgrade being silent. True only
     * when a timestamp was actually discarded, so the screen tells the accounts that lost
     * something and stays quiet for the ones — every self-service signup — that never had it.
     */
    email_verification_cleared: changingEmail && account.emailVerifiedAt !== null,
  });
}

interface ReauthInput {
  request: NextRequest;
  /** The stored address, so the limiter window is keyed on the account and not on typed input. */
  email: string;
  passwordHash: string;
  candidate: string;
}

/**
 * Re-authentication for a sensitive change (SET-01-01). Returns the response to send, or null when
 * the password was correct.
 *
 * Rate limited on the same windows as `POST /auth/login`, on purpose. This verifies the same
 * credential against the same account, so leaving it unmetered would hand an attacker a password
 * oracle one route away from the one AC-002 protects — and a session thief is exactly the caller
 * who would use it. Sharing the window rather than adding a private one is also what keeps the
 * identity lockout meaningful: five wrong guesses is five, whichever endpoint they arrive at.
 *
 * The limiter is inspected before Argon2id runs, as in login, so a locked-out identity never costs
 * a verification.
 */
async function verifyCurrentPassword(input: ReauthInput): Promise<NextResponse | null> {
  const limiter = rateLimiter();
  const subject = {
    identifier: input.email,
    ip: clientIp(input.request),
    pepper: env().HASH_PEPPER,
  };

  const gate = await limiter.loginAttempt(subject);
  if (isDenied(gate)) {
    return apiError('AUTH_RATE_LIMITED', 'Too many attempts. Please try again shortly.', {
      retryAfterSeconds: gate.retryAfterSeconds,
      details: { fields: ['current_password'] },
    });
  }

  const matches = await passwordHasher().verify(input.passwordHash, input.candidate);
  if (!matches) {
    const failure = await limiter.loginFailure(subject);
    // 401 / AUTH_INVALID_CREDENTIALS per 23_API_Error_Codes.md. The caller's session is untouched:
    // this says the password was wrong, not that they are signed out, and the screen treats it as
    // a field error rather than as a reason to bounce them to /login.
    return apiError('AUTH_INVALID_CREDENTIALS', 'That password is not correct.', {
      details: { fields: ['current_password'] },
      ...(isDenied(failure) ? { retryAfterSeconds: failure.retryAfterSeconds } : {}),
    });
  }

  // A correct password forgives that account's earlier failures, exactly as a successful login
  // does, so a run of typos here cannot lock the owner out of the login screen.
  await limiter.loginSuccess(subject);
  return null;
}

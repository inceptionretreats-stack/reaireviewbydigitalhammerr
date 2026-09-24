import { NextResponse, type NextRequest } from 'next/server';
import { and, eq, isNull } from 'drizzle-orm';
import { passwordResetTokens, users } from '@ai-review/db';
import { issueToken, privacyHash } from '@ai-review/core';
import { forgotPasswordRequest } from '@ai-review/contracts';
import { db } from '@/lib/infra/db';
import { env } from '@/lib/infra/env';
import { apiError } from '@/lib/http/api-error';
import { readJsonObject } from '@/lib/http/request-body';
import { verifyCsrf } from '@/lib/http/csrf';
import { mailer, passwordResetEmail } from '@/lib/email/mailer';
import { clientIp, isDenied, rateLimiter } from '@/lib/http/rate-limit';
import { recordActivity } from '@/lib/activity/recorder';
import { safeError } from '@/lib/infra/safe-error';

/** Short enough to limit the window a leaked link stays useful; long enough to reach an inbox. */
const TOKEN_TTL_MS = 60 * 60 * 1000;

/**
 * POST /api/v1/auth/forgot-password — AUTH-03.
 *
 * AUTH-03-01 governs the entire shape of this handler: it "always returns neutral success
 * wording". So every path below returns the same 202 — unknown address, known address, mail
 * transport failure, even a rate-limited caller. Anything else makes this an account enumerator,
 * which matters more here than on most endpoints because the address is the only input.
 *
 * The consequence to hold onto: a caller learns nothing from the response, so all the diagnosis
 * lives in the server log.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const csrf = verifyCsrf(request);
  if (!csrf.ok) return apiError('FORBIDDEN', 'Request rejected.');

  // Every rejection here answers `accepted()`, never a validation error: a malformed body
  // must be indistinguishable from an address that simply has no account.
  const rawResult = await readJsonObject(request);
  if (!rawResult.ok) return accepted();

  const parsed = forgotPasswordRequest.safeParse(rawResult.body);
  if (!parsed.success) return accepted();

  const { email } = parsed.data;
  const ip = clientIp(request);

  // Reuses the login-failure dimensions: this endpoint is attacked the same way (many addresses
  // from one prefix, or one address repeatedly) and sends mail on success, so an unlimited
  // version is also a way to have us spam a third party's inbox.
  try {
    const gate = await rateLimiter().loginFailure({
      identifier: `forgot:${email}`,
      ip,
      pepper: env().HASH_PEPPER,
    });

    // Still 202. A 429 here would confirm that the address is worth retrying.
    if (isDenied(gate)) return accepted();

    const database = db();
    const [account] = await database
      .select({ id: users.id, passwordHash: users.passwordHash })
      .from(users)
      .where(and(eq(users.email, email), isNull(users.deletedAt)))
      .limit(1);

    // A Google-only account has no local password to reset. In particular, Google may not be
    // authoritative for an external mailbox that has since changed hands. Keep the same neutral
    // response as an unknown address, without creating a recovery path around the Google subject.
    if (!account?.passwordHash) return accepted();

    const { token, tokenHash } = issueToken();

    await database.insert(passwordResetTokens).values({
      userId: account.id,
      tokenHash,
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
      // The column is a hash (13_Security): never the address itself.
      requestedIpHash: ip ? privacyHash(ip, env().HASH_PEPPER) : null,
    });

    const resetUrl = new URL(
      `/reset-password?token=${encodeURIComponent(token)}`,
      env().APP_BASE_URL,
    ).toString();

    recordActivity(request, { userId: account.id }, { action: 'auth.password.reset.request' });
    await mailer().send(passwordResetEmail(email, resetUrl));
  } catch (error) {
    // Logged, not surfaced. The user is told the same thing either way (AUTH-03-01), so this
    // log line is the only signal that a reset is failing — it belongs on an alert.
    console.error('[auth] password reset dispatch failed', safeError(error));
  }

  return accepted();
}

/**
 * The single response this endpoint can give.
 *
 * 202 rather than 200 because the work is genuinely asynchronous from the caller's point of
 * view: the request has been accepted, and whether an email exists to send is deliberately not
 * disclosed.
 */
function accepted(): NextResponse {
  return NextResponse.json(
    { message: 'If that email address has an account, a reset link is on its way.' },
    { status: 202 },
  );
}

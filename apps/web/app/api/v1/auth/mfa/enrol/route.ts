import { NextResponse, type NextRequest } from 'next/server';
import { users } from '@ai-review/db';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/infra/db';
import { apiError } from '@/lib/http/api-error';
import { mfaQrDataUri, mfaService } from '@/lib/auth/mfa';
import { requirePendingAdmin } from '@/lib/auth/mfa-routes';

export const runtime = 'nodejs';

/**
 * POST /api/v1/auth/mfa/enrol — AMENDMENT-027, step one of enrolment.
 *
 * Issues a fresh pending secret and the QR an authenticator app scans. Nothing is armed until
 * `enrol/confirm` proves the app produces the right code. Calling it again before confirming
 * simply replaces the pending secret; calling it once MFA is enabled is refused — an enrolled
 * admin re-enrols only after a reset.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const gate = await requirePendingAdmin(request);
  if (!gate.ok) return gate.response;

  const [account] = await db()
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, gate.session.userId))
    .limit(1);
  if (!account) return apiError('AUTH_REQUIRED', 'Please sign in and try again.');

  const started = await mfaService().startEnrolment(gate.session.userId, account.email);
  if ('error' in started) {
    return apiError('AUTH_MFA_ALREADY_ENROLLED', 'An authenticator app is already set up.');
  }

  return NextResponse.json({
    secret_base32: started.secretBase32,
    manual_key: started.manualKey,
    otpauth_uri: started.otpauthUri,
    qr_data_uri: await mfaQrDataUri(started.otpauthUri),
    account: account.email,
  });
}

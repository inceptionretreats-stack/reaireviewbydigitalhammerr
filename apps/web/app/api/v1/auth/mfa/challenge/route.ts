import { NextResponse, type NextRequest } from 'next/server';
import { mfaChallengeRequest } from '@ai-review/contracts';
import { apiError } from '@/lib/http/api-error';
import { readJsonObject } from '@/lib/http/request-body';
import { mfaService } from '@/lib/auth/mfa';
import {
  completeMfa,
  mfaRateGate,
  recordMfaFailure,
  requirePendingAdmin,
} from '@/lib/auth/mfa-routes';
import { recordActivity } from '@/lib/activity/recorder';

export const runtime = 'nodejs';

/**
 * POST /api/v1/auth/mfa/challenge — AMENDMENT-027.
 *
 * The code after the password, and the same call again for a step-up before a high-risk
 * action: both stamp `sessions.mfa_verified_at`. The limiter is inspected before the HMAC so
 * a locked session never gets to try, and a code accepted once is refused a second time.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const gate = await requirePendingAdmin(request);
  if (!gate.ok) return gate.response;

  const rawResult = await readJsonObject(request);
  if (!rawResult.ok) return rawResult.response;
  const raw = rawResult.body;
  const parsed = mfaChallengeRequest.safeParse(raw);
  if (!parsed.success) {
    return apiError('VALIDATION_FAILED', parsed.error.issues[0]?.message ?? 'Enter the code.');
  }

  const limited = await mfaRateGate(gate.subject);
  if (limited) return limited;

  const outcome = await mfaService().verifyCode(gate.session.userId, parsed.data.code);
  if (!outcome.ok) {
    if (outcome.reason === 'NOT_ENROLLED') {
      return apiError('AUTH_MFA_NOT_ENROLLED', 'Set up your authenticator app first.');
    }
    recordActivity(
      request,
      { session: gate.session },
      { action: 'auth.mfa.challenge', outcome: 'FAILURE', metadata: { reason: outcome.reason } },
    );
    return recordMfaFailure(gate.subject, gate.session);
  }

  recordActivity(request, { session: gate.session }, { action: 'auth.mfa.challenge' });
  const next = await completeMfa(gate.session, gate.subject);
  return NextResponse.json({ next });
}

import { NextResponse, type NextRequest } from 'next/server';
import { mfaEnrolConfirmRequest } from '@ai-review/contracts';
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
 * POST /api/v1/auth/mfa/enrol/confirm — AMENDMENT-027, step two.
 *
 * The first code from the app arms MFA, issues the eight recovery codes (shown once, never
 * stored in the clear) and verifies this session, so the admin lands in /admin without a
 * second challenge.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const gate = await requirePendingAdmin(request);
  if (!gate.ok) return gate.response;

  const rawResult = await readJsonObject(request);
  if (!rawResult.ok) return rawResult.response;
  const raw = rawResult.body;
  const parsed = mfaEnrolConfirmRequest.safeParse(raw);
  if (!parsed.success) {
    return apiError('VALIDATION_FAILED', parsed.error.issues[0]?.message ?? 'Enter the code.');
  }

  const limited = await mfaRateGate(gate.subject);
  if (limited) return limited;

  const outcome = await mfaService().confirmEnrolment(gate.session.userId, parsed.data.code, {
    ipHash: gate.ipHash,
  });
  if (!outcome.ok) {
    if (outcome.reason === 'ALREADY_ENROLLED') {
      return apiError('AUTH_MFA_ALREADY_ENROLLED', 'An authenticator app is already set up.');
    }
    if (outcome.reason === 'NO_PENDING') {
      return apiError('AUTH_MFA_NOT_ENROLLED', 'Start again — scan a new code first.');
    }
    return recordMfaFailure(gate.subject, gate.session);
  }

  recordActivity(request, { session: gate.session }, { action: 'auth.mfa.enrolled' });
  const next = await completeMfa(gate.session, gate.subject);
  return NextResponse.json({ recovery_codes: outcome.recoveryCodes, next });
}

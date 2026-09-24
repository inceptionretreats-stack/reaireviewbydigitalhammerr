import { NextResponse, type NextRequest } from 'next/server';
import { mfaRecoveryRequest } from '@ai-review/contracts';
import { apiError } from '@/lib/api-error';
import { readJsonObject } from '@/lib/request-body';
import { mfaService } from '@/lib/mfa';
import { completeMfa, mfaRateGate, recordMfaFailure, requirePendingAdmin } from '@/lib/mfa-routes';
import { recordActivity } from '@/lib/activity';

export const runtime = 'nodejs';

/**
 * POST /api/v1/auth/mfa/recovery — AMENDMENT-027. One recovery code stands in for the app,
 * once. The same limiter as the challenge applies: a recovery code is a secret to guess too.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const gate = await requirePendingAdmin(request);
  if (!gate.ok) return gate.response;

  const rawResult = await readJsonObject(request);
  if (!rawResult.ok) return rawResult.response;
  const raw = rawResult.body;
  const parsed = mfaRecoveryRequest.safeParse(raw);
  if (!parsed.success) {
    return apiError('VALIDATION_FAILED', parsed.error.issues[0]?.message ?? 'Enter a code.');
  }

  const limited = await mfaRateGate(gate.subject);
  if (limited) return limited;

  const outcome = await mfaService().consumeRecoveryCode(
    gate.session.userId,
    parsed.data.recovery_code,
    { ipHash: gate.ipHash },
  );
  if (!outcome.ok) return recordMfaFailure(gate.subject, gate.session);

  recordActivity(
    request,
    { session: gate.session },
    { action: 'auth.mfa.recovery_used', metadata: { remaining: outcome.remaining } },
  );
  const next = await completeMfa(gate.session, gate.subject);
  return NextResponse.json({ next, remaining_codes: outcome.remaining });
}

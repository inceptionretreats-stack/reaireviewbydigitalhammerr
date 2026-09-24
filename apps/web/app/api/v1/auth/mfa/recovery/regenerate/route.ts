import { NextResponse, type NextRequest } from 'next/server';
import { mfaChallengeRequest } from '@ai-review/contracts';
import { apiError } from '@/lib/api-error';
import { readJsonObject } from '@/lib/request-body';
import { mfaService } from '@/lib/mfa';
import { mfaRateGate, recordMfaFailure, requirePendingAdmin } from '@/lib/mfa-routes';
import { requireAdmin } from '@/lib/require-admin';
import { recordActivity } from '@/lib/activity';

export const runtime = 'nodejs';

/**
 * POST /api/v1/auth/mfa/recovery/regenerate — AMENDMENT-027. New recovery codes for a
 * verified admin who has lost the sheet. A fresh code from the app is required in the same
 * request, so a session left open cannot mint itself a new set.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAdmin(request, { allowViewer: true });
  if (!auth.ok) return auth.response;
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

  const verified = await mfaService().verifyCode(gate.session.userId, parsed.data.code);
  if (!verified.ok) return recordMfaFailure(gate.subject, gate.session);

  const codes = await mfaService().regenerateRecoveryCodes(gate.session.userId, {
    ipHash: gate.ipHash,
  });
  recordActivity(
    request,
    { session: gate.session },
    { action: 'auth.mfa.recovery_codes.regenerated' },
  );
  return NextResponse.json({ recovery_codes: codes });
}

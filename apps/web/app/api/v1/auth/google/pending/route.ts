import { NextResponse } from 'next/server';
import { apiError } from '@/lib/http/api-error';
import { readGooglePending } from '@/lib/auth/google-auth';

export const dynamic = 'force-dynamic';

/** Only display fields; the Google subject stays in the signed HttpOnly pending cookie. */
export async function GET(): Promise<NextResponse> {
  const pending = await readGooglePending();
  if (!pending) {
    return apiError(
      'AUTH_REQUIRED',
      'Google sign-in expired. Please try Continue with Google again.',
    );
  }
  return NextResponse.json(
    {
      email: pending.email,
      fullName: pending.fullName,
      flow: pending.flow,
      flowId: pending.flowId,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { env } from '@/lib/env';
import { issueGoogleChallenge } from '@/lib/google-auth';

export const dynamic = 'force-dynamic';

/** The nonce is echoed to GIS while its signed copy stays in a short-lived HttpOnly cookie. */
export async function GET(): Promise<NextResponse> {
  if (!env().GOOGLE_CLIENT_ID) {
    return apiError('AUTH_PROVIDER_UNAVAILABLE', 'Google sign-in is not configured yet.');
  }
  const nonce = await issueGoogleChallenge();
  return NextResponse.json({ nonce }, { headers: { 'Cache-Control': 'no-store' } });
}

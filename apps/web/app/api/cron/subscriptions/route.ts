import { NextResponse } from 'next/server';
import { apiError } from '@/lib/http/api-error';
import { env } from '@/lib/infra/env';
import { cronAuthorised } from '@/lib/cron/auth';
import { runSubscriptionSweep } from '@/lib/cron/subscriptions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/cron/subscriptions — Vercel Cron, daily at 00:30 UTC (06:00 IST), see vercel.json.
 *
 * Vercel sends `Authorization: Bearer <CRON_SECRET>`; anything else is 401, and 503 while the
 * secret is unset so a misconfigured deploy is loud rather than a job that silently never
 * runs. Safe to call twice: every step is idempotent (AMENDMENT-029).
 */
export async function GET(request: Request) {
  const check = cronAuthorised(request.headers.get('authorization'), env().CRON_SECRET);
  if (check === 'unset') return apiError('PAYMENTS_NOT_CONFIGURED', 'CRON_SECRET is not set.');
  if (check === 'wrong') return apiError('AUTH_REQUIRED', 'Not authorised.');
  const summary = await runSubscriptionSweep();
  // Kept on the warn channel: the daily line is the only trace of the sweep in Vercel's logs.
  console.warn('[cron] subscriptions', summary);
  return NextResponse.json(summary);
}

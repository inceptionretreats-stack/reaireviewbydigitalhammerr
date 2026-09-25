import { cronAuthorised } from '@/lib/cron/auth';
import { env } from '@/lib/infra/env';
import { checkBackendHealth } from '@/lib/infra/backend-health';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

const headers = { 'Cache-Control': 'no-store' };

/** Protected operational check. Never returns or logs credentials, hosts, users or raw errors. */
export async function GET(request: Request) {
  try {
    const e = env();
    const authorised = cronAuthorised(request.headers.get('authorization'), e.CRON_SECRET);
    if (authorised === 'unset') {
      return Response.json({ error: 'HEALTH_CHECK_NOT_CONFIGURED' }, { status: 503, headers });
    }
    if (authorised !== 'ok') {
      return Response.json({ error: 'AUTH_REQUIRED' }, { status: 401, headers });
    }
    const summary = await checkBackendHealth(e);
    console.warn('[cron] backend health', summary);
    return Response.json(summary, { status: summary.status === 'degraded' ? 503 : 200, headers });
  } catch {
    console.error('[cron] backend health check failed');
    return Response.json({ error: 'HEALTH_CHECK_UNAVAILABLE' }, { status: 503, headers });
  }
}

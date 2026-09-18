import { cronAuthorised } from './auth';
import type { MaintenanceSummary } from './maintenance';

/** Dependency injection keeps authorization/no-leak behavior testable without production. */
export async function handleMaintenanceRequest(
  request: Request,
  secret: string | undefined,
  run: () => Promise<MaintenanceSummary>,
): Promise<Response> {
  const auth = cronAuthorised(request.headers.get('authorization'), secret);
  const headers = { 'Cache-Control': 'no-store' };
  if (auth === 'unset')
    return Response.json({ error: 'Maintenance is not configured.' }, { status: 503, headers });
  if (auth !== 'ok') return Response.json({ error: 'Not authorised.' }, { status: 401, headers });
  try {
    const summary = await run();
    console.warn('[cron] maintenance', summary);
    return Response.json(summary, { headers });
  } catch {
    // Database errors can contain SQL parameters; do not log or return their raw messages.
    console.error(
      '[cron] maintenance failed; check database connectivity and maintenance checkpoints.',
    );
    return Response.json(
      { error: 'Maintenance failed. Completed units are safe to retry.' },
      { status: 500, headers },
    );
  }
}

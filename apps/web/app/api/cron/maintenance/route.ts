import { db } from '@/lib/infra/db';
import { env } from '@/lib/infra/env';
import { runMaintenance } from '@/lib/cron/maintenance';
import { PostgresMaintenanceStore } from '@/lib/cron/maintenance-store';
import { handleMaintenanceRequest } from '@/lib/cron/maintenance-handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Daily at 03:10 UTC (08:40 IST); also safe for authenticated operator retries. */
export async function GET(request: Request) {
  return handleMaintenanceRequest(request, env().CRON_SECRET, () =>
    runMaintenance(new PostgresMaintenanceStore(db())),
  );
}

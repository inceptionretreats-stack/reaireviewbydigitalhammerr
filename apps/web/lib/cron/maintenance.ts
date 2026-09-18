/** No timers or background promises: every completed unit is durably checkpointed. */
export const MAINTENANCE_BUDGET_MS = 30_000;
export const MAX_ANALYTICS_UNITS = 200;

export interface HousekeepingSummary {
  partitions_ensured: number;
  default_partition_rows: number;
  sessions_purged: number;
  session_cleanup_pending: boolean;
}

export interface MaintenanceStore {
  housekeeping(now: Date): Promise<HousekeepingSummary | 'busy'>;
  analyticsUnit(now: Date): Promise<'day' | 'business' | 'complete' | 'busy'>;
}

export interface MaintenanceSummary {
  status: 'complete' | 'pending' | 'busy';
  analytics_days: number;
  analytics_businesses: number;
  housekeeping: HousekeepingSummary | null;
}

export async function runMaintenance(
  store: MaintenanceStore,
  now = new Date(),
  clock: () => number = Date.now,
): Promise<MaintenanceSummary> {
  const deadline = clock() + MAINTENANCE_BUDGET_MS;
  const housekeeping = await store.housekeeping(now);
  const summary: MaintenanceSummary = {
    status: 'pending',
    analytics_days: 0,
    analytics_businesses: 0,
    housekeeping: housekeeping === 'busy' ? null : housekeeping,
  };
  if (housekeeping === 'busy') return { ...summary, status: 'busy' };

  for (let unit = 0; unit < MAX_ANALYTICS_UNITS && clock() < deadline; unit += 1) {
    const result = await store.analyticsUnit(now);
    if (result === 'busy') return { ...summary, status: 'busy' };
    if (result === 'complete') {
      return { ...summary, status: housekeeping.session_cleanup_pending ? 'pending' : 'complete' };
    }
    if (result === 'day') summary.analytics_days += 1;
    if (result === 'business') summary.analytics_businesses += 1;
  }
  // Not a false success: the next daily invocation resumes the same snapshot/cursor.
  return summary;
}

import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleMaintenanceRequest } from '../maintenance-handler';
import { MAX_ANALYTICS_UNITS, runMaintenance, type MaintenanceStore } from '../maintenance';

const housekeeping = {
  partitions_ensured: 4,
  default_partition_rows: 0,
  sessions_purged: 2,
  session_cleanup_pending: false,
};
function store(): MaintenanceStore {
  return {
    housekeeping: vi.fn(async () => housekeeping),
    analyticsUnit: vi.fn(async () => 'complete' as const),
  };
}
afterEach(() => vi.restoreAllMocks());

describe('bounded maintenance runner', () => {
  it('reports completion and counts only committed units', async () => {
    const target = store();
    vi.mocked(target.analyticsUnit).mockResolvedValueOnce('day').mockResolvedValueOnce('business');
    expect(await runMaintenance(target)).toEqual({
      status: 'complete',
      analytics_days: 1,
      analytics_businesses: 1,
      housekeeping,
    });
  });
  it('does not run analytics when another housekeeping transaction owns the lock', async () => {
    const target = store();
    vi.mocked(target.housekeeping).mockResolvedValue('busy');
    expect((await runMaintenance(target)).status).toBe('busy');
    expect(target.analyticsUnit).not.toHaveBeenCalled();
  });
  it('stops on an analytics overlap instead of racing the cursor', async () => {
    const target = store();
    vi.mocked(target.analyticsUnit).mockResolvedValue('busy');
    expect((await runMaintenance(target)).status).toBe('busy');
    expect(target.analyticsUnit).toHaveBeenCalledTimes(1);
  });
  it('returns pending at the unit cap so later invocations can resume', async () => {
    const target = store();
    vi.mocked(target.analyticsUnit).mockResolvedValue('day');
    const result = await runMaintenance(target, new Date(), () => 0);
    expect(result.status).toBe('pending');
    expect(result.analytics_days).toBe(MAX_ANALYTICS_UNITS);
  });
  it('stops starting new units when the soft runtime budget is used', async () => {
    const target = store();
    const clock = vi.fn().mockReturnValueOnce(0).mockReturnValue(31_000);
    expect((await runMaintenance(target, new Date(), clock)).status).toBe('pending');
    expect(target.analyticsUnit).not.toHaveBeenCalled();
  });
  it('reports a session cleanup backlog rather than claiming completion', async () => {
    const target = store();
    vi.mocked(target.housekeeping).mockResolvedValue({
      ...housekeeping,
      session_cleanup_pending: true,
    });
    expect((await runMaintenance(target)).status).toBe('pending');
  });
  it('propagates errors without retrying a failing unit in a loop', async () => {
    const target = store();
    vi.mocked(target.analyticsUnit).mockRejectedValue(new Error('database unavailable'));
    await expect(runMaintenance(target)).rejects.toThrow();
    expect(target.analyticsUnit).toHaveBeenCalledTimes(1);
  });
});

describe('maintenance HTTP authorization and error hygiene', () => {
  const request = (authorization?: string) =>
    new Request('https://example.test/api/cron/maintenance', {
      headers: authorization ? { authorization } : {},
    });
  it.each([undefined, '', 'Bearer wrong'])(
    'rejects unauthorized request %s before any work',
    async (header) => {
      const run = vi.fn();
      expect((await handleMaintenanceRequest(request(header), 'secret', run)).status).toBe(401);
      expect(run).not.toHaveBeenCalled();
    },
  );
  it('fails closed if no secret is configured', async () => {
    const run = vi.fn();
    expect((await handleMaintenanceRequest(request('Bearer secret'), undefined, run)).status).toBe(
      503,
    );
    expect(run).not.toHaveBeenCalled();
  });
  it('returns a no-store summary for an authenticated invocation', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await handleMaintenanceRequest(request('Bearer secret'), 'secret', () =>
      runMaintenance(store()),
    );
    expect(result.status).toBe(200);
    expect(result.headers.get('cache-control')).toBe('no-store');
    expect(await result.json()).toMatchObject({ status: 'complete' });
  });
  it('never leaks database parameters into the response or logs', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await handleMaintenanceRequest(request('Bearer secret'), 'secret', async () => {
      throw new Error('SQL params password=do-not-print');
    });
    expect(result.status).toBe(500);
    expect(await result.text()).not.toContain('do-not-print');
    expect(JSON.stringify(log.mock.calls)).not.toContain('do-not-print');
  });
});

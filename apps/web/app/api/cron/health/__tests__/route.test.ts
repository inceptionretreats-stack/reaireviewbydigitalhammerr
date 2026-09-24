import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ health: vi.fn(), env: vi.fn() }));
vi.mock('@/lib/infra/env', () => ({ env: mocks.env }));
vi.mock('@/lib/infra/backend-health', () => ({ checkBackendHealth: mocks.health }));

import { GET } from '../route';

function request(token?: string) {
  return new Request('https://app.example/api/cron/health', {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.env.mockReturnValue({ CRON_SECRET: 'private-cron-secret' });
  mocks.health.mockResolvedValue({ status: 'healthy', checks: {}, warnings: [] });
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe('protected backend health route', () => {
  it.each([undefined, 'wrong-secret'])(
    'refuses invalid authorization (%s) without probing',
    async (token) => {
      const response = await GET(request(token));
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: 'AUTH_REQUIRED' });
      expect(mocks.health).not.toHaveBeenCalled();
      expect(console.warn).not.toHaveBeenCalled();
    },
  );

  it('fails closed when the cron secret is absent', async () => {
    mocks.env.mockReturnValue({});
    expect((await GET(request('any'))).status).toBe(503);
    expect(mocks.health).not.toHaveBeenCalled();
  });

  it.each(['healthy', 'warning'] as const)(
    'returns a safe, uncached %s summary',
    async (status) => {
      const summary = { status, checks: {}, warnings: [] };
      mocks.health.mockResolvedValue(summary);
      const response = await GET(request('private-cron-secret'));
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.json()).toEqual(summary);
      expect(console.warn).toHaveBeenCalledWith('[cron] backend health', summary);
    },
  );

  it('returns 503 when a core dependency is unavailable', async () => {
    mocks.health.mockResolvedValue({ status: 'degraded', checks: {}, warnings: [] });
    expect((await GET(request('private-cron-secret'))).status).toBe(503);
  });

  it.each(['env', 'health'] as const)(
    'redacts %s errors in both logs and response',
    async (stage) => {
      mocks[stage].mockImplementation(() => {
        throw new Error('private-password user@example.com');
      });
      const response = await GET(request('private-cron-secret'));
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: 'HEALTH_CHECK_UNAVAILABLE' });
      expect(console.error).toHaveBeenCalledExactlyOnceWith('[cron] backend health check failed');
    },
  );
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  revoke: vi.fn(),
  clearSessionCookie: vi.fn(),
  recordActivity: vi.fn(),
}));

vi.mock('@/lib/env', () => ({
  env: () => ({
    APP_BASE_URL: 'https://app.example',
    CSRF_TRUSTED_ORIGINS: [],
    NODE_ENV: 'production',
  }),
}));
vi.mock('../../../../../../lib/env', () => ({
  env: () => ({
    APP_BASE_URL: 'https://app.example',
    CSRF_TRUSTED_ORIGINS: [],
    NODE_ENV: 'production',
  }),
}));
vi.mock('@/lib/db', () => ({ db: vi.fn() }));
vi.mock('@/lib/api-error', async () => import('../../../../../../lib/api-error'));
vi.mock('@/lib/csrf', async () => import('../../../../../../lib/csrf'));
vi.mock('@/lib/auth-helpers', () => ({ passwordHasher: vi.fn() }));
vi.mock('@/lib/rate-limit', () => ({
  clientIp: vi.fn(),
  isDenied: vi.fn(),
  rateLimiter: vi.fn(),
}));
vi.mock('@/lib/session', () => ({
  getSession: mocks.getSession,
  sessionService: () => ({ revoke: mocks.revoke }),
  clearSessionCookie: mocks.clearSessionCookie,
}));
vi.mock('@/lib/activity', () => ({ recordActivity: mocks.recordActivity }));

import { DELETE } from '../route';

function request(origin?: string): NextRequest {
  return new NextRequest('https://app.example/api/v1/auth/login', {
    method: 'DELETE',
    ...(origin ? { headers: { origin } } : {}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSession.mockResolvedValue({ sessionId: 'session-1', userId: 'owner-1' });
  mocks.revoke.mockResolvedValue(undefined);
  mocks.clearSessionCookie.mockResolvedValue(undefined);
});

describe('legacy DELETE /api/v1/auth/login', () => {
  it('rejects a cross-origin request before touching the session', async () => {
    const response = await DELETE(request('https://attacker.example'));

    expect(response.status).toBe(403);
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(mocks.revoke).not.toHaveBeenCalled();
    expect(mocks.clearSessionCookie).not.toHaveBeenCalled();
  });

  it('revokes the durable session and clears the cookie', async () => {
    const response = await DELETE(request('https://app.example'));

    expect(response.status).toBe(204);
    expect(mocks.revoke).toHaveBeenCalledWith('session-1', 'USER_LOGOUT');
    expect(mocks.clearSessionCookie).toHaveBeenCalledOnce();
    expect(mocks.recordActivity).toHaveBeenCalledOnce();
    expect(mocks.revoke.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.clearSessionCookie.mock.invocationCallOrder[0]!,
    );
  });

  it('remains idempotent when no session exists', async () => {
    mocks.getSession.mockResolvedValueOnce(null);

    const response = await DELETE(request('https://app.example'));

    expect(response.status).toBe(204);
    expect(mocks.revoke).not.toHaveBeenCalled();
    expect(mocks.clearSessionCookie).toHaveBeenCalledOnce();
  });
});

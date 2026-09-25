import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  pending: vi.fn(),
  database: vi.fn(),
}));

vi.mock('@/lib/http/csrf', () => ({ verifyCsrf: () => ({ ok: true }) }));
vi.mock('@/lib/infra/env', () => ({ env: () => ({ HASH_PEPPER: 'test-pepper' }) }));
vi.mock('@/lib/auth/google-auth', () => ({
  readGooglePending: mocks.pending,
  clearGooglePending: vi.fn(),
}));
vi.mock('@/lib/infra/db', () => ({ db: mocks.database }));
vi.mock('@/lib/auth/password-hasher', () => ({ passwordHasher: vi.fn() }));
vi.mock('@/lib/auth/google-auth-session', () => ({ signInGoogleVendor: vi.fn() }));
vi.mock('@/lib/http/rate-limit', () => ({
  clientIp: vi.fn(),
  rateLimiter: vi.fn(),
  isDenied: vi.fn(),
}));
vi.mock('@/lib/activity/recorder', () => ({ recordActivity: vi.fn() }));
vi.mock('@/lib/infra/safe-error', () => ({ isUniqueViolation: vi.fn(), safeError: vi.fn() }));

import { POST } from '../route';

const FLOW_ID = 'a'.repeat(32);

function request(flowId: string): NextRequest {
  return new NextRequest('https://app.example/api/v1/auth/google/link', {
    method: 'POST',
    headers: { origin: 'https://app.example', 'content-type': 'application/json' },
    body: JSON.stringify({ flow_id: flowId, password: 'correct-or-incorrect' }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.pending.mockResolvedValue({
    flowId: FLOW_ID,
    sub: '1234567890',
    email: 'owner@gmail.com',
    fullName: 'Owner',
    flow: 'link',
    authoritativeEmail: true,
  });
});

describe('Google account linking', () => {
  it('rejects a stale form from a different Google attempt before password or database access', async () => {
    const response = await POST(request('b'.repeat(32)));
    expect(response.status).toBe(401);
    expect(mocks.database).not.toHaveBeenCalled();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  gate: vi.fn(),
  lookup: vi.fn(),
  insert: vi.fn(),
  send: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: () => ({
    select: () => ({ from: () => ({ where: () => ({ limit: mocks.lookup }) }) }),
    insert: () => ({ values: mocks.insert }),
  }),
}));
vi.mock('@/lib/env', () => ({
  env: () => ({ HASH_PEPPER: 'test-pepper', APP_BASE_URL: 'https://app.example' }),
}));
vi.mock('@/lib/csrf', () => ({ verifyCsrf: () => ({ ok: true }) }));
vi.mock('@/lib/rate-limit', () => ({
  clientIp: () => '',
  rateLimiter: () => ({ loginFailure: mocks.gate }),
  isDenied: (gate: { allowed: boolean }) => !gate.allowed,
}));
vi.mock('@/lib/mailer', () => ({
  mailer: () => ({ send: mocks.send }),
  passwordResetEmail: () => ({ text: 'secret-reset-token' }),
}));
vi.mock('@/lib/activity', () => ({ recordActivity: vi.fn() }));
vi.mock('@/lib/api-error', async () => import('../../../../../../lib/api-error'));
vi.mock('@/lib/safe-error', async () => import('../../../../../../lib/safe-error'));
vi.mock('@ai-review/core', () => ({
  issueToken: () => ({ token: 'secret-reset-token', tokenHash: 'secret-token-hash' }),
  privacyHash: () => 'hashed-ip',
}));

import { POST } from '../route';

function request(): NextRequest {
  return new NextRequest('https://app.example/api/v1/auth/forgot-password', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'owner@example.com' }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.gate.mockResolvedValue({ allowed: true });
  mocks.lookup.mockResolvedValue([{ id: 'owner-id' }]);
  mocks.insert.mockResolvedValue(undefined);
  mocks.send.mockResolvedValue(undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => vi.restoreAllMocks());

describe('forgot-password neutral failures', () => {
  it('sends the reset for a known account and returns neutral success', async () => {
    const response = await POST(request());
    expect(response.status).toBe(202);
    expect(mocks.send).toHaveBeenCalledOnce();
  });

  it.each(['gate', 'lookup', 'insert', 'send'] as const)(
    'keeps the same safe response when %s fails',
    async (stage) => {
      mocks[stage].mockRejectedValueOnce(
        new Error('owner@example.com secret-reset-token', { cause: { code: '08006' } }),
      );
      const response = await POST(request());
      expect(response.status).toBe(202);
      expect(await response.json()).toEqual({
        message: 'If that email address has an account, a reset link is on its way.',
      });
      expect(console.error).toHaveBeenCalledWith(
        '[auth] password reset dispatch failed',
        'database_error (08006)',
      );
    },
  );

  it('does not send for an unknown account', async () => {
    mocks.lookup.mockResolvedValueOnce([]);
    expect((await POST(request())).status).toBe(202);
    expect(mocks.send).not.toHaveBeenCalled();
  });
});

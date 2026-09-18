import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  hash: vi.fn(),
  settings: vi.fn(),
  transaction: vi.fn(),
  createSession: vi.fn(),
  setCookie: vi.fn(),
  recordActivity: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ db: () => ({ transaction: mocks.transaction }) }));
vi.mock('@/lib/env', () => ({
  env: () => ({ HASH_PEPPER: 'test-pepper', DEFAULT_TIMEZONE: 'Asia/Kolkata' }),
}));
vi.mock('@/lib/csrf', () => ({ verifyCsrf: () => ({ ok: true }) }));
vi.mock('@/lib/auth-helpers', () => ({
  passwordHasher: () => ({ hash: mocks.hash }),
  SHELL_CATEGORY: 'OTHER',
  shellBusinessName: () => 'Test business',
}));
vi.mock('@/lib/session', () => ({
  sessionService: () => ({ create: mocks.createSession }),
  setSessionCookie: mocks.setCookie,
  landingPathFor: () => '/onboarding/business',
}));
vi.mock('@/lib/rate-limit', () => ({ clientIp: () => '' }));
vi.mock('@/lib/activity', () => ({ recordActivity: mocks.recordActivity }));
vi.mock('@/lib/api-error', async () => import('../../../../../../lib/api-error'));
vi.mock('@/lib/safe-error', async () => import('../../../../../../lib/safe-error'));
vi.mock('@ai-review/core', () => ({
  normalizePhone: () => ({ ok: true, e164: '+919000000000' }),
  validatePasswordStrength: () => ({ ok: true }),
  privacyHash: () => 'hashed-ip',
  PlatformSettingsService: class {
    values = mocks.settings;
  },
}));

import { POST } from '../route';

function request(): NextRequest {
  return new NextRequest('https://app.example/api/v1/auth/signup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      full_name: 'Test Owner',
      email: 'owner@example.com',
      mobile: '9000000000',
      password: 'test-password-long-enough',
      accept_terms: true,
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.hash.mockResolvedValue('test-hash');
  mocks.settings.mockResolvedValue({});
  mocks.transaction.mockResolvedValue('test-user-id');
  mocks.createSession.mockResolvedValue({ token: 'session-token', expiresAt: new Date() });
  mocks.setCookie.mockResolvedValue(undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => vi.restoreAllMocks());

describe('signup failure recovery', () => {
  it('keeps the successful signup response', async () => {
    const response = await POST(request());
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ onboarding_required: true });
    expect(mocks.createSession).toHaveBeenCalledOnce();
  });

  it('handles a nested duplicate email as validation, not a server failure', async () => {
    mocks.transaction.mockRejectedValueOnce(
      new Error('SQL params secret', { cause: { code: '23505' } }),
    );
    const response = await POST(request());
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { details: { fields: ['email'] } } });
    expect(mocks.createSession).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it.each(['hash', 'settings'] as const)(
    'returns a safe JSON error when %s fails before account creation',
    async (stage) => {
      mocks[stage].mockRejectedValueOnce(new Error('user@example.com secret-password'));
      const response = await POST(request());
      expect(response.status).toBe(500);
      expect(await response.json()).toMatchObject({ error: { code: 'INTERNAL_ERROR' } });
      expect(mocks.transaction).not.toHaveBeenCalled();
      expect(console.error).toHaveBeenCalledWith('[auth] signup failed', 'error');
    },
  );

  it.each(['createSession', 'setCookie'] as const)(
    'reports the committed account truthfully when %s fails',
    async (stage) => {
      mocks[stage].mockRejectedValueOnce(new Error('sensitive session parameters'));
      const response = await POST(request());
      expect(response.status).toBe(500);
      expect(await response.json()).toMatchObject({
        error: {
          message: expect.stringContaining('Your account was created'),
          details: { account_created: true, next: '/login' },
        },
      });
      expect(mocks.transaction).toHaveBeenCalledOnce();
      expect(mocks.recordActivity).toHaveBeenCalledOnce();
      expect(console.error).toHaveBeenCalledWith(
        '[auth] signup session failed after account creation',
        'error',
      );
    },
  );
});

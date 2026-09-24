import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  queryResults: [] as unknown[][],
  nonce: vi.fn(),
  verifyCredential: vi.fn(),
  setPending: vi.fn(),
  signIn: vi.fn(),
  loginAttempt: vi.fn(),
  loginFailure: vi.fn(),
  recordActivity: vi.fn(),
}));

vi.mock('@/lib/csrf', () => ({ verifyCsrf: () => ({ ok: true }) }));
vi.mock('@/lib/api-error', async () => import('../../../../../../lib/api-error'));
vi.mock('@/lib/safe-error', async () => import('../../../../../../lib/safe-error'));
vi.mock('@/lib/env', () => ({
  env: () => ({ GOOGLE_CLIENT_ID: '123-test.apps.googleusercontent.com', HASH_PEPPER: 'pepper' }),
}));
vi.mock('@/lib/google-auth', () => ({
  consumeGoogleChallenge: mocks.nonce,
  verifyGoogleCredential: mocks.verifyCredential,
  setGooglePending: mocks.setPending,
}));
vi.mock('@/lib/google-auth-session', () => ({ signInGoogleVendor: mocks.signIn }));
vi.mock('@/lib/rate-limit', () => ({
  clientIp: () => '203.0.113.10',
  rateLimiter: () => ({
    loginAttempt: mocks.loginAttempt,
    loginFailure: mocks.loginFailure,
  }),
  isDenied: (decision: { allowed: boolean }) => !decision.allowed,
}));
vi.mock('@/lib/activity', () => ({ recordActivity: mocks.recordActivity }));
vi.mock('@/lib/db', () => ({
  db: () => ({
    select: () => ({
      from: () => ({
        innerJoin: () => ({ where: () => ({ limit: () => mocks.queryResults.shift() ?? [] }) }),
        where: () => ({ limit: () => mocks.queryResults.shift() ?? [] }),
      }),
    }),
  }),
}));

import { POST } from '../route';

function request(): NextRequest {
  return new NextRequest('https://app.example/api/v1/auth/google', {
    method: 'POST',
    headers: { origin: 'https://app.example', 'content-type': 'application/json' },
    body: JSON.stringify({ credential: 'google-token'.repeat(20) }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.queryResults = [];
  mocks.nonce.mockResolvedValue('nonce');
  mocks.verifyCredential.mockResolvedValue({
    sub: '1234567890',
    email: 'owner@gmail.com',
    fullName: 'Owner',
    authoritativeEmail: true,
  });
  mocks.loginAttempt.mockResolvedValue({ allowed: true });
  mocks.loginFailure.mockResolvedValue({ allowed: true });
});

describe('vendor Google sign-in', () => {
  it('rejects a missing browser nonce before database access', async () => {
    mocks.nonce.mockResolvedValueOnce(null);
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(mocks.verifyCredential).not.toHaveBeenCalled();
  });

  it('starts registration for an unknown Google subject and unused email', async () => {
    mocks.queryResults = [[], []];
    const response = await POST(request());
    expect(await response.json()).toEqual({ next: '/signup/google' });
    expect(mocks.setPending).toHaveBeenCalledWith(
      expect.objectContaining({ flow: 'signup', sub: '1234567890' }),
    );
    expect(mocks.signIn).not.toHaveBeenCalled();
  });

  it('requires password proof for an existing password account', async () => {
    mocks.queryResults = [[], [{ id: 'user-1', role: 'BUSINESS_OWNER', passwordHash: 'hash', disabledAt: null }]];
    const response = await POST(request());
    expect(await response.json()).toEqual({ next: '/signup/google' });
    expect(mocks.setPending).toHaveBeenCalledWith(expect.objectContaining({ flow: 'link' }));
    expect(mocks.signIn).not.toHaveBeenCalled();
  });

  it('signs in a previously linked vendor by Google subject', async () => {
    mocks.queryResults = [[{
      userId: 'user-1',
      role: 'BUSINESS_OWNER',
      disabledAt: null,
      deletedAt: null,
      lockedUntil: null,
    }]];
    const response = await POST(request());
    expect(await response.json()).toEqual({ next: '/app' });
    expect(mocks.signIn).toHaveBeenCalledWith(expect.anything(), 'user-1');
    expect(mocks.setPending).not.toHaveBeenCalled();
  });

  it('does not allow an admin to bypass password/MFA through Google', async () => {
    mocks.queryResults = [[{
      userId: 'admin-1',
      role: 'SUPER_ADMIN',
      disabledAt: null,
      deletedAt: null,
      lockedUntil: null,
    }]];
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(mocks.signIn).not.toHaveBeenCalled();
  });
});

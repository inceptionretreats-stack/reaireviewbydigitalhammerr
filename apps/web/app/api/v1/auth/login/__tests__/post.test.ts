import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  lookup: vi.fn(),
  lockedLookup: vi.fn(),
  verify: vi.fn(),
  loginAttempt: vi.fn(),
  loginSuccess: vi.fn(),
  getSession: vi.fn(),
  mfaRequired: vi.fn(),
  transaction: vi.fn(),
  revoke: vi.fn(),
  create: vi.fn(),
  resetCounters: vi.fn(),
  setCookie: vi.fn(),
  recordActivity: vi.fn(),
  tx: { select: vi.fn(), update: vi.fn() },
}));

vi.mock('@/lib/db', () => ({
  db: () => ({
    select: () => ({ from: () => ({ where: () => ({ limit: mocks.lookup }) }) }),
    transaction: mocks.transaction,
  }),
}));
vi.mock('@/lib/env', () => ({ env: () => ({ HASH_PEPPER: 'test-pepper' }) }));
vi.mock('@/lib/csrf', () => ({ verifyCsrf: () => ({ ok: true }) }));
vi.mock('@/lib/auth-helpers', () => ({ passwordHasher: () => ({ verify: mocks.verify }) }));
vi.mock('@/lib/session', async () => {
  const actual = await import('../../../../../../lib/session');
  return {
    ...actual,
    adminMfaRequired: mocks.mfaRequired,
    getSession: mocks.getSession,
    setSessionCookie: mocks.setCookie,
  };
});
vi.mock('@/lib/rate-limit', () => ({
  clientIp: () => '203.0.113.42',
  isDenied: (decision: { allowed: boolean }) => !decision.allowed,
  rateLimiter: () => ({
    loginAttempt: mocks.loginAttempt,
    loginSuccess: mocks.loginSuccess,
  }),
}));
vi.mock('@/lib/activity', () => ({ recordActivity: mocks.recordActivity }));
vi.mock('@/lib/api-error', async () => import('../../../../../../lib/api-error'));
vi.mock('@ai-review/core', () => ({
  ADMIN_SESSION_TTL_MS: 12 * 60 * 60 * 1000,
  MFA_PENDING_TTL_MS: 10 * 60 * 1000,
  isAdminRole: (role: string) => role === 'SUPER_ADMIN' || role === 'BUSINESS_SUPPORT_VIEWER',
  privacyHash: () => 'hashed-ip',
  SessionService: class {
    constructor(private readonly executor: unknown) {}
    revoke(sessionId: string, reason: string) {
      return mocks.revoke(this.executor, sessionId, reason);
    }
    create(input: unknown) {
      return mocks.create(this.executor, input);
    }
  },
}));

import { POST } from '../route';

function request(): NextRequest {
  return new NextRequest('https://app.example/api/v1/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: 'owner@example.com',
      password: 'current-password',
      remember_me: true,
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.lookup.mockResolvedValue([
    { id: 'owner-id', passwordHash: 'old-hash', lockedUntil: null, disabledAt: null },
  ]);
  mocks.lockedLookup.mockResolvedValue([
    {
      id: 'owner-id',
      role: 'BUSINESS_OWNER',
      passwordHash: 'old-hash',
      lockedUntil: null,
      disabledAt: null,
      mfaEnabledAt: null,
    },
  ]);
  mocks.verify.mockResolvedValue(true);
  mocks.loginAttempt.mockResolvedValue({ allowed: true });
  mocks.loginSuccess.mockResolvedValue(undefined);
  mocks.getSession.mockResolvedValue({ sessionId: 'prior-session' });
  mocks.mfaRequired.mockReturnValue(true);
  mocks.revoke.mockResolvedValue(undefined);
  mocks.create.mockResolvedValue({ token: 'new-token', expiresAt: new Date('2030-01-01') });
  mocks.resetCounters.mockResolvedValue(undefined);
  mocks.setCookie.mockResolvedValue(undefined);
  mocks.transaction.mockImplementation(async (work: (tx: unknown) => Promise<unknown>) =>
    work(mocks.tx),
  );
  mocks.tx.select.mockImplementation(() => ({
    from: () => ({ where: () => ({ for: () => ({ limit: mocks.lockedLookup }) }) }),
  }));
  mocks.tx.update.mockImplementation(() => ({ set: () => ({ where: mocks.resetCounters }) }));
});

describe('password login and concurrent credential changes', () => {
  it('rechecks the locked credential before creating a session in the same transaction', async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ next: '/app', mfa: null });
    expect(mocks.lockedLookup).toHaveBeenCalledOnce();
    expect(mocks.revoke).toHaveBeenCalledWith(mocks.tx, 'prior-session', 'REPLACED_BY_LOGIN');
    expect(mocks.create).toHaveBeenCalledWith(
      mocks.tx,
      expect.objectContaining({
        userId: 'owner-id',
        ipHash: 'hashed-ip',
        rememberMe: true,
      }),
    );
    expect(mocks.lockedLookup.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.create.mock.invocationCallOrder[0]!,
    );
    expect(mocks.resetCounters).toHaveBeenCalledOnce();
    expect(mocks.transaction.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.setCookie.mock.invocationCallOrder[0]!,
    );
    expect(mocks.loginSuccess).toHaveBeenCalledOnce();
  });

  it('rejects a password changed while the initial hash was being verified', async () => {
    mocks.lockedLookup.mockResolvedValueOnce([
      {
        id: 'owner-id',
        role: 'BUSINESS_OWNER',
        passwordHash: 'changed-hash',
        lockedUntil: null,
        disabledAt: null,
        mfaEnabledAt: null,
      },
    ]);

    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: 'AUTH_INVALID_CREDENTIALS' } });
    expect(mocks.revoke).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.loginSuccess).not.toHaveBeenCalled();
    expect(mocks.setCookie).not.toHaveBeenCalled();
  });

  it('does not issue a session after a concurrent account disable', async () => {
    mocks.lockedLookup.mockResolvedValueOnce([
      {
        id: 'owner-id',
        role: 'BUSINESS_OWNER',
        passwordHash: 'old-hash',
        lockedUntil: null,
        disabledAt: new Date(),
        mfaEnabledAt: null,
      },
    ]);

    expect((await POST(request())).status).toBe(401);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('keeps an admin session pending for MFA using the locked role and MFA state', async () => {
    const mfaEnabledAt = new Date('2026-01-01');
    mocks.lockedLookup.mockResolvedValueOnce([
      {
        id: 'owner-id',
        role: 'SUPER_ADMIN',
        passwordHash: 'old-hash',
        lockedUntil: null,
        disabledAt: null,
        mfaEnabledAt,
      },
    ]);

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ next: '/login/mfa', mfa: 'challenge' });
    expect(mocks.create).toHaveBeenCalledWith(
      mocks.tx,
      expect.objectContaining({ ttlMs: 10 * 60 * 1000 }),
    );
  });

  it('routes an admin without MFA enrolment to the enrolment screen', async () => {
    mocks.lockedLookup.mockResolvedValueOnce([
      {
        id: 'owner-id',
        role: 'SUPER_ADMIN',
        passwordHash: 'old-hash',
        lockedUntil: null,
        disabledAt: null,
        mfaEnabledAt: null,
      },
    ]);

    const response = await POST(request());

    expect(await response.json()).toEqual({ next: '/login/mfa/enrol', mfa: 'enrol' });
    expect(mocks.create).toHaveBeenCalledWith(
      mocks.tx,
      expect.objectContaining({ ttlMs: 10 * 60 * 1000 }),
    );
  });

  it('keeps the twelve-hour admin session when MFA is disabled', async () => {
    mocks.mfaRequired.mockReturnValueOnce(false);
    mocks.lockedLookup.mockResolvedValueOnce([
      {
        id: 'owner-id',
        role: 'SUPER_ADMIN',
        passwordHash: 'old-hash',
        lockedUntil: null,
        disabledAt: null,
        mfaEnabledAt: null,
      },
    ]);

    const response = await POST(request());

    expect(await response.json()).toEqual({ next: '/admin', mfa: null });
    expect(mocks.create).toHaveBeenCalledWith(
      mocks.tx,
      expect.objectContaining({ ttlMs: 12 * 60 * 60 * 1000 }),
    );
  });
});

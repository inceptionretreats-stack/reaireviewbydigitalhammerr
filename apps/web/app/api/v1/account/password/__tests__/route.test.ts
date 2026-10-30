import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { passwordResetTokens, users } from '@ai-review/db';

const mocks = vi.hoisted(() => ({
  lookup: vi.fn(),
  verify: vi.fn(),
  hash: vi.fn(),
  loginAttempt: vi.fn(),
  loginSuccess: vi.fn(),
  transaction: vi.fn(),
  updateUser: vi.fn(),
  sweepTokens: vi.fn(),
  countSessions: vi.fn(),
  revoke: vi.fn(),
  rotate: vi.fn(),
  setCookie: vi.fn(),
  recordActivity: vi.fn(),
  tx: { update: vi.fn() },
}));

vi.mock('@/lib/db', () => ({
  db: () => ({
    select: () => ({ from: () => ({ where: () => ({ limit: mocks.lookup }) }) }),
    transaction: mocks.transaction,
  }),
}));
vi.mock('@/lib/env', () => ({ env: () => ({ HASH_PEPPER: 'test-pepper' }) }));
vi.mock('@/lib/require-tenant', () => ({
  requireTenant: () =>
    Promise.resolve({
      ok: true,
      context: {
        session: { userId: 'owner-id', sessionId: 'current-session' },
        businessId: 'business-id',
      },
    }),
}));
vi.mock('@/lib/auth-helpers', () => ({
  passwordHasher: () => ({ verify: mocks.verify, hash: mocks.hash }),
}));
vi.mock('@/lib/rate-limit', () => ({
  clientIp: () => '203.0.113.42',
  isDenied: (decision: { allowed: boolean }) => !decision.allowed,
  rateLimiter: () => ({
    loginAttempt: mocks.loginAttempt,
    loginSuccess: mocks.loginSuccess,
  }),
}));
vi.mock('@/lib/session', () => ({ setSessionCookie: mocks.setCookie }));
vi.mock('../../session-count', () => ({
  countOtherLiveSessions: mocks.countSessions,
  reportableRevoked: (live: number, revoked: number) => Math.min(live, revoked),
}));
vi.mock('@/lib/activity', () => ({ recordActivity: mocks.recordActivity }));
vi.mock('@/lib/api-error', async () => import('../../../../../../lib/api-error'));
vi.mock('@/lib/safe-error', async () => import('../../../../../../lib/safe-error'));
vi.mock('@ai-review/core', () => ({
  validatePasswordStrength: () => ({ ok: true }),
  privacyHash: () => 'hashed-ip',
  SessionService: class {
    constructor(private readonly executor: unknown) {}
    revokeAllForUser(userId: string, reason: string, exceptId: string) {
      return mocks.revoke(this.executor, userId, reason, exceptId);
    }
    rotate(sessionId: string, input: unknown) {
      return mocks.rotate(this.executor, sessionId, input);
    }
  },
}));

import { POST } from '../route';

function request(): NextRequest {
  return new NextRequest('https://app.example/api/v1/account/password', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      current_password: 'old-password-long-enough',
      new_password: 'new-password-long-enough',
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.lookup.mockResolvedValue([{ email: 'owner@example.com', passwordHash: 'old-hash' }]);
  mocks.verify.mockResolvedValue(true);
  mocks.hash.mockResolvedValue('new-hash');
  mocks.loginAttempt.mockResolvedValue({ allowed: true });
  mocks.loginSuccess.mockResolvedValue(undefined);
  mocks.updateUser.mockResolvedValue([{ id: 'owner-id' }]);
  mocks.sweepTokens.mockResolvedValue(undefined);
  mocks.countSessions.mockResolvedValue(2);
  mocks.revoke.mockResolvedValue(2);
  mocks.rotate.mockResolvedValue({ token: 'new-token', expiresAt: new Date('2030-01-01') });
  mocks.setCookie.mockResolvedValue(undefined);
  mocks.transaction.mockImplementation(async (work: (tx: unknown) => Promise<unknown>) =>
    work(mocks.tx),
  );
  mocks.tx.update.mockImplementation((table) => {
    if (table === users) {
      return { set: () => ({ where: () => ({ returning: mocks.updateUser }) }) };
    }
    if (table === passwordResetTokens) {
      return { set: () => ({ where: mocks.sweepTokens }) };
    }
    throw new Error('Unexpected table');
  });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('account password change security boundary', () => {
  it('changes the credential, invalidates reset links, and rotates sessions in one transaction', async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      sessions_swept: true,
      session_retained: true,
      other_sessions_signed_out: 2,
    });
    expect(mocks.tx.update).toHaveBeenNthCalledWith(1, users);
    expect(mocks.tx.update).toHaveBeenNthCalledWith(2, passwordResetTokens);
    expect(mocks.countSessions).toHaveBeenCalledWith(mocks.tx, 'owner-id', 'current-session');
    expect(mocks.revoke).toHaveBeenCalledWith(
      mocks.tx,
      'owner-id',
      'PASSWORD_CHANGED',
      'current-session',
    );
    expect(mocks.rotate).toHaveBeenCalledWith(
      mocks.tx,
      'current-session',
      expect.objectContaining({ userId: 'owner-id', ipHash: 'hashed-ip' }),
    );
    expect(mocks.rotate.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.setCookie.mock.invocationCallOrder[0]!,
    );
  });

  it('does not revoke sessions when the conditional credential update loses a race', async () => {
    mocks.updateUser.mockResolvedValueOnce([]);

    expect((await POST(request())).status).toBe(422);
    expect(mocks.sweepTokens).not.toHaveBeenCalled();
    expect(mocks.revoke).not.toHaveBeenCalled();
    expect(mocks.rotate).not.toHaveBeenCalled();
    expect(mocks.setCookie).not.toHaveBeenCalled();
  });

  it.each(['sweepTokens', 'revoke', 'rotate'] as const)(
    'propagates a %s failure to roll back the transaction',
    async (stage) => {
      const failure = new Error('sensitive SQL detail');
      mocks[stage].mockRejectedValueOnce(failure);
      let rejected = false;
      mocks.transaction.mockImplementationOnce(async (work: (tx: unknown) => Promise<unknown>) => {
        try {
          return await work(mocks.tx);
        } catch (error) {
          rejected = true;
          expect(error).toBe(failure);
          throw error;
        }
      });

      expect((await POST(request())).status).toBe(500);
      expect(rejected).toBe(true);
      expect(mocks.setCookie).not.toHaveBeenCalled();
      expect(mocks.recordActivity).not.toHaveBeenCalled();
    },
  );

  it('reports a committed change without claiming this browser kept its session if the cookie fails', async () => {
    mocks.setCookie.mockRejectedValueOnce(new Error('cookie write failed'));

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      sessions_swept: true,
      session_retained: false,
      message: expect.stringContaining('sign in again'),
    });
    expect(mocks.recordActivity).toHaveBeenCalledOnce();
  });
});

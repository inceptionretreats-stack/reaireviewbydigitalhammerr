import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { passwordResetTokens, users } from '@ai-review/db';

const mocks = vi.hoisted(() => ({
  lookup: vi.fn(),
  hash: vi.fn(),
  transaction: vi.fn(),
  claim: vi.fn(),
  passwordUpdate: vi.fn(),
  tokenSweep: vi.fn(),
  lockUser: vi.fn(),
  revoke: vi.fn(),
  clearCookie: vi.fn(),
  recordActivity: vi.fn(),
  tx: { select: vi.fn(), update: vi.fn() },
}));

vi.mock('@/lib/db', () => ({
  db: () => ({
    select: () => ({ from: () => ({ where: () => ({ limit: mocks.lookup }) }) }),
    transaction: mocks.transaction,
  }),
}));
vi.mock('@/lib/csrf', () => ({ verifyCsrf: () => ({ ok: true }) }));
vi.mock('@/lib/auth-helpers', () => ({ passwordHasher: () => ({ hash: mocks.hash }) }));
vi.mock('@/lib/session', () => ({ clearSessionCookie: mocks.clearCookie }));
vi.mock('@/lib/activity', () => ({ recordActivity: mocks.recordActivity }));
vi.mock('@/lib/api-error', async () => import('../../../../../../lib/api-error'));
vi.mock('@/lib/safe-error', async () => import('../../../../../../lib/safe-error'));
vi.mock('@ai-review/core', () => ({
  hashToken: () => 'reset-token-digest',
  validatePasswordStrength: () => ({ ok: true }),
  SessionService: class {
    constructor(private readonly executor: unknown) {}
    revokeAllForUser(userId: string, reason: string) {
      return mocks.revoke(this.executor, userId, reason);
    }
  },
}));

import { POST } from '../route';

function request(): NextRequest {
  return new NextRequest('https://app.example/api/v1/auth/reset-password', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      token: 'test-reset-token-at-least-20-characters',
      password: 'new-test-password-long-enough',
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.lookup.mockResolvedValue([{ id: 'reset-token-id', userId: 'owner-id' }]);
  mocks.hash.mockResolvedValue('new-password-hash');
  mocks.claim.mockResolvedValue([{ userId: 'owner-id' }]);
  mocks.passwordUpdate.mockResolvedValue(undefined);
  mocks.tokenSweep.mockResolvedValue(undefined);
  mocks.lockUser.mockResolvedValue([{ id: 'owner-id' }]);
  mocks.revoke.mockResolvedValue(2);
  mocks.clearCookie.mockResolvedValue(undefined);
  mocks.transaction.mockImplementation(async (work: (tx: unknown) => Promise<unknown>) =>
    work(mocks.tx),
  );
  mocks.tx.select.mockImplementation(() => ({
    from: () => ({ where: () => ({ for: () => ({ limit: mocks.lockUser }) }) }),
  }));
  let tokenUpdates = 0;
  mocks.tx.update.mockImplementation((table) => {
    if (table === passwordResetTokens) {
      tokenUpdates += 1;
      return tokenUpdates === 1
        ? { set: () => ({ where: () => ({ returning: mocks.claim }) }) }
        : { set: () => ({ where: mocks.tokenSweep }) };
    }
    if (table === users) return { set: () => ({ where: mocks.passwordUpdate }) };
    throw new Error('Unexpected table');
  });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => vi.restoreAllMocks());

describe('password reset security boundary', () => {
  it('checks token validity before hashing, then changes the password and revokes through the SAME transaction', async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.lookup.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.hash.mock.invocationCallOrder[0]!,
    );
    expect(mocks.hash.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.transaction.mock.invocationCallOrder[0]!,
    );
    expect(mocks.tx.select).toHaveBeenCalledOnce();
    expect(mocks.lockUser.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.claim.mock.invocationCallOrder[0]!,
    );
    expect(mocks.tx.update).toHaveBeenNthCalledWith(1, passwordResetTokens);
    expect(mocks.tx.update).toHaveBeenNthCalledWith(2, users);
    expect(mocks.tx.update).toHaveBeenNthCalledWith(3, passwordResetTokens);
    expect(mocks.tokenSweep).toHaveBeenCalledOnce();
    expect(mocks.revoke).toHaveBeenCalledWith(mocks.tx, 'owner-id', 'PASSWORD_RESET');
    expect(mocks.passwordUpdate.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.tokenSweep.mock.invocationCallOrder[0]!,
    );
    expect(mocks.tokenSweep.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.revoke.mock.invocationCallOrder[0]!,
    );
    expect(mocks.revoke.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.clearCookie.mock.invocationCallOrder[0]!,
    );
  });

  it('does not hash or mutate when the token lookup rejects an unknown, expired or used link', async () => {
    mocks.lookup.mockResolvedValueOnce([]);
    const response = await POST(request());
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: { message: 'That reset link is no longer valid. Please request a new one.' },
    });
    expect(mocks.hash).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('re-checks the claim after hashing and does not update the password when another request consumed the token', async () => {
    mocks.claim.mockResolvedValueOnce([]);
    expect((await POST(request())).status).toBe(422);
    expect(mocks.hash).toHaveBeenCalledOnce();
    expect(mocks.tx.update).toHaveBeenCalledOnce();
    expect(mocks.passwordUpdate).not.toHaveBeenCalled();
    expect(mocks.revoke).not.toHaveBeenCalled();
    expect(mocks.clearCookie).not.toHaveBeenCalled();
  });

  it('does not claim a token if the account disappeared before the row lock', async () => {
    mocks.lockUser.mockResolvedValueOnce([]);

    expect((await POST(request())).status).toBe(422);
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.passwordUpdate).not.toHaveBeenCalled();
  });

  it('rolls the credential change back if sibling-token invalidation fails', async () => {
    const failure = new Error('reset token sweep failed');
    mocks.tokenSweep.mockRejectedValueOnce(failure);
    let transactionRejected = false;
    mocks.transaction.mockImplementationOnce(async (work: (tx: unknown) => Promise<unknown>) => {
      try {
        return await work(mocks.tx);
      } catch (error) {
        transactionRejected = true;
        expect(error).toBe(failure);
        throw error;
      }
    });

    expect((await POST(request())).status).toBe(500);
    expect(transactionRejected).toBe(true);
    expect(mocks.revoke).not.toHaveBeenCalled();
    expect(mocks.clearCookie).not.toHaveBeenCalled();
  });

  it('propagates a revocation failure out of the transaction so PostgreSQL rolls all reset writes back', async () => {
    const failure = new Error('SQL with secret-password-hash', { cause: { code: '08006' } });
    mocks.revoke.mockRejectedValueOnce(failure);
    let transactionRejected = false;
    mocks.transaction.mockImplementationOnce(async (work: (tx: unknown) => Promise<unknown>) => {
      try {
        return await work(mocks.tx);
      } catch (error) {
        transactionRejected = true;
        expect(error).toBe(failure);
        throw error;
      }
    });
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(transactionRejected).toBe(true);
    expect(mocks.clearCookie).not.toHaveBeenCalled();
    expect(mocks.recordActivity).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      '[auth] password reset failed',
      'database_error (08006)',
    );
  });

  it.each(['lookup', 'hash'] as const)(
    'handles a %s failure without claiming the token',
    async (stage) => {
      mocks[stage].mockRejectedValueOnce(new Error('secret reset input'));
      expect((await POST(request())).status).toBe(500);
      expect(mocks.transaction).not.toHaveBeenCalled();
      expect(console.error).toHaveBeenCalledWith('[auth] password reset failed', 'error');
    },
  );

  it('does not claim failure after a committed reset if browser cookie cleanup fails', async () => {
    mocks.clearCookie.mockRejectedValueOnce(new Error('cookie unavailable'));
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      message: 'Your password has been changed. Please sign in.',
      next: '/login',
    });
    expect(mocks.revoke).toHaveBeenCalledWith(mocks.tx, 'owner-id', 'PASSWORD_RESET');
    expect(mocks.recordActivity).toHaveBeenCalledOnce();
    expect(console.error).toHaveBeenCalledWith(
      '[auth] reset cookie cleanup failed after password change',
      'error',
    );
  });
});

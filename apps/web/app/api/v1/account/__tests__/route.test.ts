import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { passwordResetTokens, users } from '@ai-review/db';

const mocks = vi.hoisted(() => ({
  lookup: vi.fn(),
  verify: vi.fn(),
  loginAttempt: vi.fn(),
  loginSuccess: vi.fn(),
  transaction: vi.fn(),
  updateUser: vi.fn(),
  sweepTokens: vi.fn(),
  recordActivity: vi.fn(),
  loadAccountSettings: vi.fn(),
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
vi.mock('@/lib/auth-helpers', () => ({ passwordHasher: () => ({ verify: mocks.verify }) }));
vi.mock('@/lib/rate-limit', () => ({
  clientIp: () => '203.0.113.42',
  isDenied: (decision: { allowed: boolean }) => !decision.allowed,
  rateLimiter: () => ({
    loginAttempt: mocks.loginAttempt,
    loginSuccess: mocks.loginSuccess,
  }),
}));
vi.mock('@/lib/activity', () => ({ recordActivity: mocks.recordActivity }));
vi.mock('@/lib/api-error', async () => import('../../../../../lib/api-error'));
vi.mock('@/lib/safe-error', async () => import('../../../../../lib/safe-error'));
vi.mock('@/components/dashboard/settings/account', () => ({
  loadAccountSettings: mocks.loadAccountSettings,
}));
vi.mock('@ai-review/core', () => ({
  normalizePhone: () => ({ ok: true, e164: '+919000000000' }),
}));

import { GET, PATCH } from '../route';

function request(email = 'new@example.com'): NextRequest {
  return new NextRequest('https://app.example/api/v1/account', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      full_name: 'Test Owner',
      email,
      mobile: '9000000000',
      current_password: 'current-password-long-enough',
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.lookup.mockResolvedValue([
    { email: 'old@example.com', passwordHash: 'old-hash', emailVerifiedAt: new Date() },
  ]);
  mocks.verify.mockResolvedValue(true);
  mocks.loginAttempt.mockResolvedValue({ allowed: true });
  mocks.loginSuccess.mockResolvedValue(undefined);
  mocks.updateUser.mockResolvedValue([{ id: 'owner-id' }]);
  mocks.sweepTokens.mockResolvedValue(undefined);
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

describe('account email change and reset links', () => {
  it('invalidates outstanding links in the same transaction as the email update', async () => {
    const response = await PATCH(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ email_verification_cleared: true });
    expect(mocks.verify).toHaveBeenCalledWith('old-hash', 'current-password-long-enough');
    expect(mocks.tx.update).toHaveBeenNthCalledWith(1, users);
    expect(mocks.tx.update).toHaveBeenNthCalledWith(2, passwordResetTokens);
    expect(mocks.sweepTokens).toHaveBeenCalledOnce();
  });

  it('does not invalidate links for a details edit that keeps the email', async () => {
    expect((await PATCH(request('old@example.com'))).status).toBe(200);
    expect(mocks.verify).not.toHaveBeenCalled();
    expect(mocks.tx.update).toHaveBeenCalledOnce();
    expect(mocks.sweepTokens).not.toHaveBeenCalled();
  });

  it('rejects a stale account update without invalidating links', async () => {
    mocks.updateUser.mockResolvedValueOnce([]);

    expect((await PATCH(request())).status).toBe(422);
    expect(mocks.sweepTokens).not.toHaveBeenCalled();
    expect(mocks.recordActivity).not.toHaveBeenCalled();
  });

  it('rolls back an email change if link invalidation fails', async () => {
    const failure = new Error('SQL detail with private email');
    mocks.sweepTokens.mockRejectedValueOnce(failure);
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

    expect((await PATCH(request())).status).toBe(500);
    expect(transactionRejected).toBe(true);
    expect(mocks.recordActivity).not.toHaveBeenCalled();
  });
});

describe('GET /api/v1/account', () => {
  const get = () => new NextRequest('https://app.example/api/v1/account');

  it("returns the caller's own details without the password hash", async () => {
    mocks.loadAccountSettings.mockResolvedValueOnce({
      account: {
        fullName: 'Test Owner',
        email: 'owner@example.com',
        mobile: '+919000000000',
        hasPassword: true,
      },
      business: { name: 'Cafe', status: 'ACTIVE', publishedAt: null, timezone: 'Asia/Kolkata' },
      billing: { billingLegalName: '', gstin: '', billingStateCode: '', billingAddress: '' },
      otherLiveSessions: 2,
    });

    const response = await GET(get());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      full_name: 'Test Owner',
      email: 'owner@example.com',
      mobile: '+919000000000',
      has_password: true,
      other_live_sessions: 2,
    });
    expect(mocks.loadAccountSettings).toHaveBeenCalledWith(
      expect.anything(),
      'owner-id',
      'current-session',
      'business-id',
    );
  });

  it('answers 404 when the account row is missing', async () => {
    mocks.loadAccountSettings.mockResolvedValueOnce(null);

    const response = await GET(get());

    expect(response.status).toBe(404);
  });
});

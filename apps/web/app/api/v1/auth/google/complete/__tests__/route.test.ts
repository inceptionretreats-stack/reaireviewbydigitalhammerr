import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  pending: vi.fn(),
  clear: vi.fn(),
  transaction: vi.fn(),
  settings: vi.fn(),
  signIn: vi.fn(),
  inserts: [] as unknown[],
}));

vi.mock('@/lib/http/csrf', () => ({ verifyCsrf: () => ({ ok: true }) }));
vi.mock('@/lib/auth/google-auth', () => ({
  readGooglePending: mocks.pending,
  clearGooglePending: mocks.clear,
}));
vi.mock('@/lib/auth/google-auth-session', () => ({ signInGoogleVendor: mocks.signIn }));
vi.mock('@/lib/tenant/tenant-shell', () => ({
  SHELL_CATEGORY: 'OTHER',
  shellBusinessName: (name: string) => `${name}'s business`,
}));
vi.mock('@/lib/infra/env', () => ({ env: () => ({ DEFAULT_TIMEZONE: 'Asia/Kolkata' }) }));
vi.mock('@/lib/activity/recorder', () => ({ recordActivity: vi.fn() }));
vi.mock('@ai-review/core', () => ({
  normalizePhone: () => ({ ok: true, e164: '+919000000000' }),
  PlatformSettingsService: class {
    values = mocks.settings;
  },
}));
vi.mock('@/lib/infra/db', () => ({ db: () => ({ transaction: mocks.transaction }) }));

import { POST } from '../route';

const FLOW_ID = 'a'.repeat(32);

function request(body: Record<string, unknown>): NextRequest {
  return new NextRequest('https://app.example/api/v1/auth/google/complete', {
    method: 'POST',
    headers: { origin: 'https://app.example', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.inserts = [];
  mocks.pending.mockResolvedValue({
    flowId: FLOW_ID,
    sub: '1234567890',
    email: 'owner@gmail.com',
    fullName: 'Owner',
    flow: 'signup',
    authoritativeEmail: true,
  });
  mocks.settings.mockResolvedValue({
    free_generation_limit: 10,
    pro_generation_limit: 2000,
    annual_price_paise: 99900,
  });
  mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
    const tx = {
      insert: () => ({
        values: (value: unknown) => {
          mocks.inserts.push(value);
          return {
            returning: async () => [{ id: mocks.inserts.length === 1 ? 'user-1' : 'business-1' }],
          };
        },
      }),
    };
    return callback(tx);
  });
});

describe('Google vendor registration completion', () => {
  it('requires a live Google pending cookie', async () => {
    mocks.pending.mockResolvedValueOnce(null);
    const response = await POST(
      request({ flow_id: FLOW_ID, full_name: 'Owner', mobile: '9000000000', accept_terms: true }),
    );
    expect(response.status).toBe(401);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('rejects a different Google attempt before writing account data', async () => {
    const response = await POST(
      request({
        flow_id: 'b'.repeat(32),
        full_name: 'Owner',
        mobile: '9000000000',
        accept_terms: true,
      }),
    );
    expect(response.status).toBe(401);
    expect(mocks.settings).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('requires terms acceptance before creating an account', async () => {
    const response = await POST(
      request({ flow_id: FLOW_ID, full_name: 'Owner', mobile: '9000000000', accept_terms: false }),
    );
    expect(response.status).toBe(422);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('creates a passwordless owner, Google identity, draft business and free plan atomically', async () => {
    const response = await POST(
      request({ flow_id: FLOW_ID, full_name: 'Owner', mobile: '9000000000', accept_terms: true }),
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ next: '/onboarding/business' });
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.inserts).toHaveLength(4);
    expect(mocks.inserts[0]).toMatchObject({
      email: 'owner@gmail.com',
      passwordHash: null,
      role: 'BUSINESS_OWNER',
    });
    expect(mocks.inserts[1]).toMatchObject({ googleSubject: '1234567890', userId: 'user-1' });
    expect(mocks.inserts[2]).toMatchObject({ status: 'DRAFT', ownerUserId: 'user-1' });
    expect(mocks.inserts[3]).toMatchObject({ status: 'FREE', businessId: 'business-1' });
    expect(mocks.clear).toHaveBeenCalledOnce();
    expect(mocks.signIn).toHaveBeenCalledWith(expect.anything(), 'user-1');
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireTenant: vi.fn(),
  db: vi.fn(),
  transaction: vi.fn(),
  forUpdate: vi.fn(),
  lockedBusiness: vi.fn(),
  upsertContext: vi.fn(),
  existingModes: vi.fn(),
  insertMode: vi.fn(),
  updateBusiness: vi.fn(),
  recordActivity: vi.fn(),
}));

vi.mock('@/lib/require-tenant', () => ({ requireTenant: mocks.requireTenant }));
vi.mock('@/lib/db', () => ({ db: mocks.db }));
vi.mock('@/lib/api-error', async () => import('../../../../../../lib/api-error'));
vi.mock('@/lib/activity', () => ({ recordActivity: mocks.recordActivity }));

import { aiBusinessContexts, businesses, reviewModes } from '@ai-review/db';
import { PUT } from '../route';

function request(body: string): NextRequest {
  return new NextRequest('https://app.example/api/v1/ai/context', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body,
  });
}

function tenant(status: string): void {
  mocks.lockedBusiness.mockResolvedValue([{ status }]);
  mocks.requireTenant.mockResolvedValue({
    ok: true,
    context: {
      businessId: 'business-1',
      status,
      session: { userId: 'owner-1' },
    },
  });
}

describe('PUT /api/v1/ai/context tenant state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.mockReturnValue({ transaction: mocks.transaction });
    mocks.forUpdate.mockReturnValue({ limit: mocks.lockedBusiness });
    mocks.transaction.mockImplementation(async (work: (tx: unknown) => Promise<unknown>) =>
      work({
        insert: (table: unknown) =>
          table === aiBusinessContexts
            ? { values: () => ({ onConflictDoUpdate: mocks.upsertContext }) }
            : table === reviewModes
              ? { values: mocks.insertMode }
              : undefined,
        select: () => ({
          from: (table: unknown) => ({
            where: () =>
              table === businesses ? { for: mocks.forUpdate } : { limit: mocks.existingModes },
          }),
        }),
        update: () => ({ set: () => ({ where: mocks.updateBusiness }) }),
      }),
    );
    mocks.upsertContext.mockResolvedValue(undefined);
    mocks.existingModes.mockResolvedValue([]);
    mocks.insertMode.mockResolvedValue(undefined);
    mocks.updateBusiness.mockResolvedValue(undefined);
  });

  it.each(['SUSPENDED', 'CLOSED'])('rejects %s before parsing or writing', async (status) => {
    tenant(status);

    const response = await PUT(request('{malformed json'));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: 'BUSINESS_NOT_ACTIVE', message: 'This business is not active.' },
    });
    expect(mocks.db).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.recordActivity).not.toHaveBeenCalled();
  });

  it.each(['DRAFT', 'ACTIVE'])('permits %s to save AI context', async (status) => {
    tenant(status);

    const response = await PUT(
      request(
        JSON.stringify({
          summary: 'A local shop',
          services: ['Haircut'],
          context_terms: [],
          draft_language: 'hinglish',
        }),
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ saved: true });
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.forUpdate).toHaveBeenCalledWith('update');
    expect(mocks.lockedBusiness.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.upsertContext.mock.invocationCallOrder[0]!,
    );
    expect(mocks.upsertContext).toHaveBeenCalledOnce();
    expect(mocks.updateBusiness).toHaveBeenCalledOnce();
    expect(mocks.recordActivity).toHaveBeenCalledOnce();
  });

  it.each(['SUSPENDED', 'CLOSED'])(
    'rejects a %s state that appears before the business row is locked',
    async (lockedStatus) => {
      tenant('ACTIVE');
      mocks.lockedBusiness.mockResolvedValue([{ status: lockedStatus }]);

      const response = await PUT(request('{}'));

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        error: { code: 'BUSINESS_NOT_ACTIVE' },
      });
      expect(mocks.forUpdate).toHaveBeenCalledWith('update');
      expect(mocks.upsertContext).not.toHaveBeenCalled();
      expect(mocks.insertMode).not.toHaveBeenCalled();
      expect(mocks.updateBusiness).not.toHaveBeenCalled();
      expect(mocks.recordActivity).not.toHaveBeenCalled();
    },
  );
});

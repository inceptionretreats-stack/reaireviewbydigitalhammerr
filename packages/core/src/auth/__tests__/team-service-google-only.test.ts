import { describe, expect, it, vi } from 'vitest';
import type { Executor } from '../../db-executor';
import { PasswordHasher } from '../password';
import { TeamService } from '../team-service';

describe('admin role changes for Google-only vendors', () => {
  it('rejects promotion without a password before changing the role or revoking sessions', async () => {
    const update = vi.fn();
    const tx = {
      select: () => ({
        from: () => ({
          where: () => ({
            for: () => ({
              limit: async () => [
                {
                  id: 'vendor-id',
                  role: 'BUSINESS_OWNER',
                  passwordHash: null,
                  disabledAt: null,
                },
              ],
            }),
          }),
        }),
      }),
      update,
    };
    const database = {
      transaction: (callback: (executor: typeof tx) => Promise<unknown>) => callback(tx),
    } as unknown as Executor;
    const service = new TeamService(database, {
      hasher: new PasswordHasher({ pepper: 'test-pepper' }),
    });

    await expect(
      service.changeRole('vendor-id', {
        actor: { userId: 'admin-id', ipHash: null },
        reason: 'Promotion',
        role: 'SUPER_ADMIN',
      }),
    ).rejects.toMatchObject({ code: 'CREDENTIAL_REQUIRED' });
    expect(update).not.toHaveBeenCalled();
  });
});

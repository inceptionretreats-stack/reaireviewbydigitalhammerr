import { describe, expect, it, vi } from 'vitest';
import {
  AuditActorRequiredError,
  AuditReasonRequiredError,
  AuditWriter,
  HIGH_RISK_ACTIONS,
} from '../audit/writer';

/**
 * RBAC rule 5 and AMENDMENT-029 at the writer: a high-risk action without a reason, or a
 * non-system action without a person, never reaches the table.
 */
function executorSpy() {
  const values = vi.fn(async () => undefined);
  const insert = vi.fn(() => ({ values }));
  return { executor: { insert } as never, insert, values };
}

describe('AuditWriter', () => {
  it('refuses a high-risk action without a reason before touching the database', async () => {
    const { executor, insert } = executorSpy();
    await expect(
      new AuditWriter(executor).record({ actorUserId: 'u1', action: 'business.suspend' }),
    ).rejects.toBeInstanceOf(AuditReasonRequiredError);
    await expect(
      new AuditWriter(executor).record({
        actorUserId: 'u1',
        action: 'payment.refund',
        reason: '   ',
      }),
    ).rejects.toBeInstanceOf(AuditReasonRequiredError);
    expect(insert).not.toHaveBeenCalled();
  });

  it('refuses an admin action with no actor, and accepts a system action without one', async () => {
    const { executor, values } = executorSpy();
    await expect(
      new AuditWriter(executor).record({ actorUserId: null, action: 'business.update' }),
    ).rejects.toBeInstanceOf(AuditActorRequiredError);

    await new AuditWriter(executor).record({
      actorUserId: null,
      actorType: 'SYSTEM',
      action: 'subscription.expire',
      reason: 'cron:subscriptions',
      businessId: 'b1',
    });
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: null,
        actorType: 'SYSTEM',
        action: 'subscription.expire',
        businessId: 'b1',
      }),
    );
  });

  it('defaults the actor type to ADMIN and keeps before/after as given', async () => {
    const { executor, values } = executorSpy();
    await new AuditWriter(executor).record({
      actorUserId: 'u1',
      action: 'business.entitlement.adjust',
      reason: 'launch partner',
      before: { status: 'FREE' },
      after: { status: 'PRO_ACTIVE' },
    });
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        actorType: 'ADMIN',
        beforeState: { status: 'FREE' },
        afterState: { status: 'PRO_ACTIVE' },
      }),
    );
  });

  it('lists every payment, team and abuse action as high-risk', () => {
    for (const action of [
      'payment.refund',
      'payment.reconcile',
      'payment.mark_failed',
      'user.mfa.reset',
      'user.disable',
      'user.invite.create',
      'business.ai.suspend',
      'business.ai.throttle',
      'business.warn',
    ]) {
      expect(HIGH_RISK_ACTIONS.has(action)).toBe(true);
    }
  });
});

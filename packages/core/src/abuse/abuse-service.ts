import { eq } from 'drizzle-orm';
import { businesses, type Database } from '@ai-review/db';
import { AuditWriter } from '../audit/writer';
import type { Executor } from '../db-executor';
import { auditActorType, type AdminAction } from '../audit/actor';

/**
 * The admin's answers to an abuse signal (AMENDMENT-030): warn, suspend Ai, throttle, and
 * their reversals. All high-risk in the audit sense — a reason is demanded and recorded —
 * and all narrower than a business suspension: the public page and the Google button keep
 * working, only Ai drafting is affected.
 *
 * `warn` records the fact and returns what the email should say; sending is the web app's
 * job, so a warning is audited even when there is no mail transport to carry it.
 */

export class AbuseTargetNotFoundError extends Error {
  constructor(businessId: string) {
    super(`No business ${businessId}`);
    this.name = 'AbuseTargetNotFoundError';
  }
}

export interface AiControls {
  aiSuspendedAt: Date | null;
  aiSuspendedReason: string | null;
  aiThrottleUntil: Date | null;
  aiThrottlePerHour: number | null;
}

export class AbuseService {
  constructor(private readonly db: Database) {}

  async controls(businessId: string): Promise<AiControls | null> {
    const [row] = await this.db
      .select({
        aiSuspendedAt: businesses.aiSuspendedAt,
        aiSuspendedReason: businesses.aiSuspendedReason,
        aiThrottleUntil: businesses.aiThrottleUntil,
        aiThrottlePerHour: businesses.aiThrottlePerHour,
      })
      .from(businesses)
      .where(eq(businesses.id, businessId))
      .limit(1);
    return row ?? null;
  }

  /** Records the warning; the caller emails the owner with `message`. */
  async warn(businessId: string, input: AdminAction & { message: string }): Promise<void> {
    await this.audited(businessId, input, 'business.warn', async () => ({
      before: {},
      after: { message: input.message.slice(0, 500) },
    }));
  }

  async suspendAi(businessId: string, input: AdminAction): Promise<void> {
    await this.audited(businessId, input, 'business.ai.suspend', async (tx, before) => {
      const now = new Date();
      await tx
        .update(businesses)
        .set({ aiSuspendedAt: now, aiSuspendedReason: input.reason.slice(0, 500), updatedAt: now })
        .where(eq(businesses.id, businessId));
      return {
        before: { ai_suspended_at: before.aiSuspendedAt?.toISOString() ?? null },
        after: { ai_suspended_at: now.toISOString() },
      };
    });
  }

  async restoreAi(businessId: string, input: AdminAction): Promise<void> {
    await this.audited(businessId, input, 'business.ai.restore', async (tx, before) => {
      await tx
        .update(businesses)
        .set({ aiSuspendedAt: null, aiSuspendedReason: null, updatedAt: new Date() })
        .where(eq(businesses.id, businessId));
      return {
        before: { ai_suspended_at: before.aiSuspendedAt?.toISOString() ?? null },
        after: { ai_suspended_at: null },
      };
    });
  }

  /** At most `perHour` drafts an hour until `until`, enforced by the public generation limiter. */
  async throttle(
    businessId: string,
    input: AdminAction & { perHour: number; until: Date },
  ): Promise<void> {
    if (!Number.isInteger(input.perHour) || input.perHour < 1 || input.perHour > 10_000) {
      throw new RangeError('perHour must be a whole number from 1 to 10000');
    }
    if (input.until.getTime() <= Date.now()) throw new RangeError('until must be in the future');
    await this.audited(businessId, input, 'business.ai.throttle', async (tx, before) => {
      await tx
        .update(businesses)
        .set({
          aiThrottleUntil: input.until,
          aiThrottlePerHour: input.perHour,
          updatedAt: new Date(),
        })
        .where(eq(businesses.id, businessId));
      return {
        before: {
          ai_throttle_until: before.aiThrottleUntil?.toISOString() ?? null,
          ai_throttle_per_hour: before.aiThrottlePerHour,
        },
        after: {
          ai_throttle_until: input.until.toISOString(),
          ai_throttle_per_hour: input.perHour,
        },
      };
    });
  }

  async unthrottle(businessId: string, input: AdminAction): Promise<void> {
    await this.audited(businessId, input, 'business.ai.unthrottle', async (tx, before) => {
      await tx
        .update(businesses)
        .set({ aiThrottleUntil: null, aiThrottlePerHour: null, updatedAt: new Date() })
        .where(eq(businesses.id, businessId));
      return {
        before: {
          ai_throttle_until: before.aiThrottleUntil?.toISOString() ?? null,
          ai_throttle_per_hour: before.aiThrottlePerHour,
        },
        after: { ai_throttle_until: null, ai_throttle_per_hour: null },
      };
    });
  }

  private async audited(
    businessId: string,
    input: AdminAction,
    action: string,
    mutate: (
      tx: Executor,
      before: AiControls,
    ) => Promise<{ before: Record<string, unknown>; after: Record<string, unknown> }>,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [before] = await tx
        .select({
          aiSuspendedAt: businesses.aiSuspendedAt,
          aiSuspendedReason: businesses.aiSuspendedReason,
          aiThrottleUntil: businesses.aiThrottleUntil,
          aiThrottlePerHour: businesses.aiThrottlePerHour,
        })
        .from(businesses)
        .where(eq(businesses.id, businessId))
        .for('update')
        .limit(1);
      if (!before) throw new AbuseTargetNotFoundError(businessId);
      const change = await mutate(tx, before);
      await new AuditWriter(tx).record({
        actorUserId: input.actor.userId,
        actorType: auditActorType(input.actor),
        ipHash: input.actor.ipHash ?? null,
        businessId,
        action,
        targetType: 'business',
        targetId: businessId,
        reason: input.reason,
        before: change.before,
        after: change.after,
      });
    });
  }
}

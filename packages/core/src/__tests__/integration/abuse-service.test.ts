import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '@ai-review/db';
import { AbuseService, AbuseTargetNotFoundError } from '../../abuse/abuse-service';
import { AuditReasonRequiredError } from '../../audit/writer';

/** AMENDMENT-030 against the real schema: every control audited, reversible, reason-gated. */
describe('AbuseService', () => {
  let pool: Pool;
  let db: Database;
  const adminId = randomUUID();
  const ownerId = randomUUID();
  const businessId = randomUUID();
  const actor = { userId: adminId };

  beforeAll(async () => {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is required for the integration suite.');
    pool = new Pool({ connectionString, max: 4 });
    db = createDatabase({ connectionString, poolMax: 4 });
    await pool.query(
      `INSERT INTO users (id, email, full_name, password_hash, role) VALUES
         ($1, $3, 'Abuse Admin', 'x', 'SUPER_ADMIN'), ($2, $4, 'Abuse Owner', 'x', 'BUSINESS_OWNER')`,
      [
        adminId,
        ownerId,
        `abuse-admin-${adminId}@example.test`,
        `abuse-owner-${ownerId}@example.test`,
      ],
    );
    await pool.query(
      `INSERT INTO businesses (id, owner_user_id, name, category, status) VALUES ($1, $2, 'Abuse Co', 'Cafe', 'ACTIVE')`,
      [businessId, ownerId],
    );
  });

  afterAll(async () => {
    await pool.query('DELETE FROM admin_audit_logs WHERE business_id = $1', [businessId]);
    await pool.query('DELETE FROM users WHERE email LIKE $1', ['abuse-%@example.test']);
    await pool.end();
  });

  async function audit() {
    const { rows } = await pool.query(
      `SELECT action, reason, before_state AS before, after_state AS after FROM admin_audit_logs WHERE business_id = $1 ORDER BY id`,
      [businessId],
    );
    return rows as Array<{ action: string; reason: string; before: unknown; after: unknown }>;
  }

  it('suspends and restores Ai, each with a reason and an audit row, leaving the business ACTIVE', async () => {
    const service = new AbuseService(db);
    await service.suspendAi(businessId, { actor, reason: 'Generation spike with incentive terms' });
    let c = await service.controls(businessId);
    expect(c?.aiSuspendedAt).toBeInstanceOf(Date);
    expect(c?.aiSuspendedReason).toBe('Generation spike with incentive terms');
    const { rows } = await pool.query('SELECT status FROM businesses WHERE id = $1', [businessId]);
    expect(rows[0].status).toBe('ACTIVE');

    await service.restoreAi(businessId, { actor, reason: 'Owner removed the terms' });
    c = await service.controls(businessId);
    expect(c?.aiSuspendedAt).toBeNull();
    expect((await audit()).map((a) => a.action)).toEqual([
      'business.ai.suspend',
      'business.ai.restore',
    ]);
  });

  it('throttles for a period and lifts it; refuses nonsense bounds', async () => {
    const service = new AbuseService(db);
    const until = new Date(Date.now() + 3_600_000);
    await service.throttle(businessId, { actor, reason: 'Fair-use warning', perHour: 20, until });
    let c = await service.controls(businessId);
    expect(c?.aiThrottlePerHour).toBe(20);
    expect(c?.aiThrottleUntil?.getTime()).toBe(until.getTime());
    await expect(
      service.throttle(businessId, { actor, reason: 'x', perHour: 0, until }),
    ).rejects.toThrow(RangeError);
    await expect(
      service.throttle(businessId, { actor, reason: 'x', perHour: 5, until: new Date(0) }),
    ).rejects.toThrow(RangeError);
    await service.unthrottle(businessId, { actor, reason: 'Behaviour normal again' });
    c = await service.controls(businessId);
    expect(c?.aiThrottleUntil).toBeNull();
    expect((await audit()).slice(-2).map((a) => a.action)).toEqual([
      'business.ai.throttle',
      'business.ai.unthrottle',
    ]);
  });

  it('records a warning with its message, and refuses every action without a reason', async () => {
    const service = new AbuseService(db);
    await service.warn(businessId, {
      actor,
      reason: 'First notice',
      message: 'Please remove the coupon text.',
    });
    const last = (await audit()).at(-1)!;
    expect(last.action).toBe('business.warn');
    expect(last.after).toEqual({ message: 'Please remove the coupon text.' });

    const before = (await audit()).length;
    await expect(service.suspendAi(businessId, { actor, reason: '' })).rejects.toBeInstanceOf(
      AuditReasonRequiredError,
    );
    await expect(
      service.warn(businessId, { actor, reason: '  ', message: 'x' }),
    ).rejects.toBeInstanceOf(AuditReasonRequiredError);
    expect((await audit()).length).toBe(before);
    expect((await service.controls(businessId))?.aiSuspendedAt).toBeNull();

    await expect(service.suspendAi(randomUUID(), { actor, reason: 'x' })).rejects.toBeInstanceOf(
      AbuseTargetNotFoundError,
    );
  });
});

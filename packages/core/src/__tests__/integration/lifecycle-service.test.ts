import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '@ai-review/db';
import {
  SubscriptionLifecycleService,
  type PendingReminder,
} from '../../billing/lifecycle-service';
import { PostgresQuotaStore } from '../../quota/postgres-store';

/** The daily sweep against the real schema (AMENDMENT-029): expiry, reminders, retries. */
describe('SubscriptionLifecycleService', () => {
  let pool: Pool;
  let db: Database;
  let ownerId: string;
  let businessId: string;
  const DAY = 86_400_000;

  beforeAll(async () => {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is required for the integration suite.');
    pool = new Pool({ connectionString, max: 4 });
    db = createDatabase({ connectionString, poolMax: 4 });
  });

  afterAll(async () => {
    await pool.query(
      `DELETE FROM admin_audit_logs WHERE business_id IN
         (SELECT id FROM businesses WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE $1))`,
      ['lifecycle-%@example.test'],
    );
    await pool.query('DELETE FROM users WHERE email LIKE $1', ['lifecycle-%@example.test']);
    await pool.end();
  });

  beforeEach(async () => {
    ownerId = randomUUID();
    businessId = randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, full_name, password_hash, role)
       VALUES ($1, $2, 'Lifecycle Owner', 'x', 'BUSINESS_OWNER')`,
      [ownerId, `lifecycle-owner-${ownerId}@example.test`],
    );
    await pool.query(
      `INSERT INTO businesses (id, owner_user_id, name, category, status)
       VALUES ($1, $2, 'Lifecycle Co', 'Cafe', 'ACTIVE')`,
      [businessId, ownerId],
    );
  });

  async function paidUntil(expiresAt: Date, status = 'PRO_ACTIVE') {
    const startsAt = new Date(expiresAt.getTime() - 365 * DAY);
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO subscriptions (business_id, status, free_generation_limit, free_generations_used,
                                  starts_at, expires_at, entitlement_source, pro_generation_limit)
       VALUES ($1, $2, 10, 10, $3, $4, 'PAYMENT', 2000) RETURNING id`,
      [businessId, status, startsAt, expiresAt],
    );
    return rows[0]!.id;
  }

  async function status() {
    const { rows } = await pool.query('SELECT status FROM subscriptions WHERE business_id = $1', [
      businessId,
    ]);
    return rows[0]?.status as string;
  }

  async function reminders() {
    const { rows } = await pool.query(
      `SELECT kind, sent_at, skipped_at, attempts, last_error FROM subscription_reminders
        WHERE business_id = $1 ORDER BY created_at`,
      [businessId],
    );
    return rows as Array<{
      kind: string;
      sent_at: Date | null;
      skipped_at: Date | null;
      attempts: number;
      last_error: string | null;
    }>;
  }

  it('flips only lapsed paid rows to EXPIRED, with a SYSTEM audit row, and the engine sees Free', async () => {
    const now = new Date();
    const subId = await paidUntil(new Date(now.getTime() - DAY));
    const service = new SubscriptionLifecycleService(db, () => now);

    const { expired } = await service.expireLapsed();
    expect(expired).toContain(businessId);
    expect(await status()).toBe('EXPIRED');
    const { rows } = await pool.query(
      `SELECT actor_user_id, actor_type, action, reason FROM admin_audit_logs WHERE target_id = $1`,
      [subId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actor_user_id: null,
      actor_type: 'SYSTEM',
      action: 'subscription.expire',
    });
    expect((await reminders()).map((r) => r.kind)).toEqual(['EXPIRED']);

    // Idempotent: a second sweep finds nothing.
    expect((await service.expireLapsed()).expired).not.toContain(businessId);

    // The quota store resolves an EXPIRED row to the free allowance.
    expect((await new PostgresQuotaStore(db).getEntitlement(businessId))?.mode).toBe('FREE');
  });

  it('leaves a year with time left, a CANCELLED row, and a FREE row alone', async () => {
    const now = new Date();
    await paidUntil(new Date(now.getTime() + 5 * DAY));
    const service = new SubscriptionLifecycleService(db, () => now);
    await service.expireLapsed();
    expect(await status()).toBe('PRO_ACTIVE');

    await pool.query('DELETE FROM subscriptions WHERE business_id = $1', [businessId]);
    await paidUntil(new Date(now.getTime() - DAY), 'CANCELLED');
    await service.expireLapsed();
    expect(await status()).toBe('CANCELLED');
  });

  it('queues the nearest due reminder once, never a further-out one after it, and sends each once', async () => {
    const now = new Date();
    await paidUntil(new Date(now.getTime() + 6.5 * DAY));
    const service = new SubscriptionLifecycleService(db, () => now);

    expect((await service.queueDueReminders()).queued).toBe(1);
    expect((await service.queueDueReminders()).queued).toBe(0);
    expect((await reminders()).map((r) => r.kind)).toEqual(['T7']);

    // The sweep is global — other fixtures' rows go out in the same call — so the assertions
    // look at this business's rows rather than the totals.
    const sent: PendingReminder[] = [];
    await service.sendPending(async (p) => {
      if (p.reminder.businessId === businessId) sent.push(p);
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.reminder.kind).toBe('T7');
    expect(sent[0]!.ownerEmail).toContain('lifecycle-owner-');
    expect((await reminders())[0]!.sent_at).not.toBeNull();
    await service.sendPending(async (p) => {
      if (p.reminder.businessId === businessId) sent.push(p);
    });
    expect(sent).toHaveLength(1);

    // Six days on, the T1 falls due; T30 is never queued for this period.
    const later = new SubscriptionLifecycleService(db, () => new Date(now.getTime() + 6 * DAY));
    expect((await later.queueDueReminders()).queued).toBe(1);
    expect((await reminders()).map((r) => r.kind)).toEqual(['T7', 'T1']);
  });

  it('a late cron sends only the nearest reminder, not every window it missed', async () => {
    const now = new Date();
    await paidUntil(new Date(now.getTime() + 0.5 * DAY));
    const service = new SubscriptionLifecycleService(db, () => now);
    expect((await service.queueDueReminders()).queued).toBe(1);
    expect((await reminders()).map((r) => r.kind)).toEqual(['T1']);
  });

  it('skips a reminder whose year was renewed before it went out, and caps retries', async () => {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 3 * DAY);
    await paidUntil(expiresAt);
    const service = new SubscriptionLifecycleService(db, () => now);
    await service.queueDueReminders();
    // Renewed: the period end moved a year on.
    await pool.query('UPDATE subscriptions SET expires_at = $2 WHERE business_id = $1', [
      businessId,
      new Date(expiresAt.getTime() + 365 * DAY),
    ]);
    const delivered: string[] = [];
    await service.sendPending(async (p) => {
      if (p.reminder.businessId === businessId) delivered.push(p.reminder.kind);
    });
    expect(delivered).toEqual([]);
    expect((await reminders())[0]).toMatchObject({ kind: 'T7', sent_at: null });
    expect((await reminders())[0]!.skipped_at).not.toBeNull();

    // A fresh period, and a transport that is down: attempts climb to the cap, then it rests.
    await pool.query('DELETE FROM subscription_reminders WHERE business_id = $1', [businessId]);
    await pool.query('UPDATE subscriptions SET expires_at = $2 WHERE business_id = $1', [
      businessId,
      expiresAt,
    ]);
    await service.queueDueReminders();
    for (let i = 0; i < 6; i += 1) {
      await service.sendPending(async (p) => {
        if (p.reminder.businessId === businessId) throw new Error('smtp down');
      });
      expect((await reminders())[0]!.attempts).toBe(Math.min(i + 1, 5));
    }
    expect((await reminders())[0]).toMatchObject({ attempts: 5, last_error: 'smtp down' });
  });
});

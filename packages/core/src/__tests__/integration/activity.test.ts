import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '@ai-review/db';
import { ActivityRecorder, listActivity, purgeActivityOlderThan } from '../../activity/recorder';

/** AMENDMENT-028 against the real table: ordering, filters, keyset paging, and retention. */
describe('activity log', () => {
  let pool: Pool;
  let db: Database;
  const userId = randomUUID();
  const businessId = randomUUID();
  const ownerEmail = `activity-${userId}@example.test`;

  beforeAll(async () => {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is required for the integration suite.');
    pool = new Pool({ connectionString, max: 4 });
    db = createDatabase({ connectionString, poolMax: 4 });
    await pool.query(
      `INSERT INTO users (id, email, full_name, password_hash, role) VALUES ($1, $2, 'Activity Owner', 'x', 'BUSINESS_OWNER')`,
      [userId, ownerEmail],
    );
    await pool.query(
      `INSERT INTO businesses (id, owner_user_id, name, category, status) VALUES ($1, $2, 'Activity Co', 'Cafe', 'ACTIVE')`,
      [businessId, userId],
    );
  });

  afterAll(async () => {
    await pool.query(
      'DELETE FROM user_activity_logs WHERE user_id = $1 OR user_id IS NULL AND action = $2',
      [userId, 'auth.signup'],
    );
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    await pool.end();
  });

  it('records, lists newest first with joins, filters, and pages by keyset', async () => {
    const recorder = new ActivityRecorder(db);
    await recorder.record({ userId, businessId, action: 'auth.login', ipHash: 'a'.repeat(64) });
    await recorder.record({
      userId,
      businessId,
      action: 'business.update',
      metadata: { slug: 'x' },
    });
    await recorder.record({ userId, action: 'auth.login', outcome: 'FAILURE' });

    const all = await listActivity(db, { userId, limit: 2 });
    expect(all.rows).toHaveLength(2);
    expect(all.rows[0]!.action).toBe('auth.login');
    expect(all.rows[0]!.outcome).toBe('FAILURE');
    expect(all.rows[0]!.userEmail).toBe(ownerEmail);
    expect(all.rows[1]!.businessName).toBe('Activity Co');
    expect(all.nextBefore).toBe(all.rows[1]!.id);

    const older = await listActivity(db, { userId, beforeId: all.nextBefore! });
    expect(older.rows.map((r) => r.action)).toEqual(['auth.login']);
    expect(older.nextBefore).toBeNull();

    expect((await listActivity(db, { userId, outcome: 'FAILURE' })).rows).toHaveLength(1);
    expect((await listActivity(db, { businessId })).rows).toHaveLength(2);
    expect(
      (await listActivity(db, { userId, actionPrefix: 'business.' })).rows.map((r) => r.action),
    ).toEqual(['business.update']);
    expect((await listActivity(db, { userId, action: 'auth.login' })).rows).toHaveLength(2);
  });

  it('keeps the row when the person is deleted, and purges only old rows', async () => {
    const recorder = new ActivityRecorder(db);
    const ghost = randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, full_name, password_hash, role) VALUES ($1, $2, 'Ghost', 'x', 'BUSINESS_OWNER')`,
      [ghost, `activity-ghost-${ghost}@example.test`],
    );
    await recorder.record({ userId: ghost, action: 'auth.signup' });
    await pool.query('DELETE FROM users WHERE id = $1', [ghost]);
    const { rows } = await pool.query(
      `SELECT user_id FROM user_activity_logs WHERE action = 'auth.signup' AND user_id IS NULL`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);

    await recorder.record({
      userId,
      action: 'qr.download',
      occurredAt: new Date('2020-01-01T00:00:00Z'),
    });
    const purged = await purgeActivityOlderThan(db, new Date('2021-01-01T00:00:00Z'), 1);
    expect(purged).toBeGreaterThanOrEqual(1);
    expect((await listActivity(db, { userId, action: 'qr.download' })).rows).toHaveLength(0);
    expect((await listActivity(db, { userId, action: 'auth.login' })).rows.length).toBeGreaterThan(
      0,
    );
  });
});

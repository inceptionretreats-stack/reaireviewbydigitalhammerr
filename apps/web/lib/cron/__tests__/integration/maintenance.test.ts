import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '@ai-review/db';
import { PostgresMaintenanceStore } from '@/lib/cron/maintenance-store';
import { runMaintenance } from '@/lib/cron/maintenance';

/** An isolated, disposable LOOPBACK database; never runs maintenance on the developer's DB. */
describe('serverless maintenance on PostgreSQL', () => {
  let admin: Pool;
  let pool: Pool;
  let database: Database;
  let store: PostgresMaintenanceStore;
  const testDatabaseName = `maintenance_test_${randomUUID().replaceAll('-', '')}`;
  const owner = randomUUID();
  const business = randomUUID();
  const secondBusiness = randomUUID();
  const now = new Date('2026-09-18T03:10:00Z');

  beforeAll(async () => {
    const connection = new URL(process.env.DATABASE_URL ?? '');
    if (
      !['localhost', '127.0.0.1', '[::1]'].includes(connection.hostname) ||
      connection.searchParams.has('host')
    ) {
      throw new Error('Maintenance integration tests require a loopback PostgreSQL server.');
    }
    admin = new Pool({ connectionString: connection.toString(), max: 1 });
    await admin.query(`CREATE DATABASE "${testDatabaseName}"`);
    connection.pathname = `/${testDatabaseName}`;
    pool = new Pool({ connectionString: connection.toString(), max: 2 });
    await migrate(drizzle(pool), { migrationsFolder: 'packages/db/drizzle' });
    database = createDatabase({ connectionString: connection.toString(), poolMax: 2, poolMin: 0 });
    store = new PostgresMaintenanceStore(database, {
      WORKER_PARTITION_MONTHS_AHEAD: 3,
      WORKER_SESSION_PURGE_GRACE_DAYS: 7,
    });
    // Provision before historical fixtures so the test remains valid in a later calendar year.
    await store.housekeeping(now);
    await pool.query(
      `insert into users (id, email, full_name, password_hash, role)
      values ($1, $2, 'Maintenance test', 'test-only', 'BUSINESS_OWNER')`,
      [owner, `${owner}@example.test`],
    );
    await pool.query(
      `insert into businesses (id, owner_user_id, name, category, status, timezone)
      values ($1, $2, 'UTC business', 'Office', 'ACTIVE', 'Etc/UTC'),
      ($3, $2, 'India business', 'Office', 'ACTIVE', 'Asia/Kolkata')`,
      [business, owner, secondBusiness],
    );
  });

  beforeEach(async () => {
    await pool.query(
      'TRUNCATE analytics_events, analytics_daily_business, maintenance_jobs, sessions',
    );
    await pool.query('update businesses set deleted_at = null');
  });

  afterAll(async () => {
    await database?.$client.end();
    await pool?.end();
    if (admin) {
      if (!/^maintenance_test_[a-f0-9]{32}$/.test(testDatabaseName))
        throw new Error('Invalid test DB cleanup target.');
      await admin.query(`DROP DATABASE IF EXISTS "${testDatabaseName}"`);
      await admin.end();
    }
  });

  async function event(id: string, occurredAt: string) {
    await pool.query(
      `insert into analytics_events (business_id, event_name, occurred_at)
      values ($1, 'google_open', $2)`,
      [id, occurredAt],
    );
  }
  async function counts() {
    return (
      await pool.query(`select business_id, metric_date::text, metric_value::int from analytics_daily_business
      where metric_name = 'event_count' and dimension_key = 'google_open'
      order by business_id, metric_date`)
    ).rows;
  }

  it('backfills historical days, resumes a persisted cursor, and reruns without double counting', async () => {
    await event(business, '2026-09-15T12:00:00Z');
    await event(business, '2026-09-17T12:00:00Z');
    await event(secondBusiness, '2026-09-15T19:00:00Z');
    expect(await store.analyticsUnit(now)).toBe('day');
    // Simulate the next invocation/cold start after one committed unit.
    const resumed = new PostgresMaintenanceStore(database);
    const result = await runMaintenance(resumed, now);
    expect(result.status).toBe('complete');
    const initial = await counts();
    expect(initial).toHaveLength(3);
    expect(initial).toContainEqual({
      business_id: secondBusiness,
      metric_date: '2026-09-16',
      metric_value: 1,
    });
    expect(await runMaintenance(resumed, now)).toMatchObject({ status: 'complete' });
    expect(await counts()).toEqual(initial);
    await event(business, '2026-09-17T13:00:00Z');
    await runMaintenance(resumed, now);
    expect(await counts()).toContainEqual({
      business_id: business,
      metric_date: '2026-09-17',
      metric_value: 2,
    });
  });

  it('catches up missed days since the last completed cycle', async () => {
    await event(business, '2026-09-15T12:00:00Z');
    await runMaintenance(store, new Date('2026-09-16T03:10:00Z'));
    await event(business, '2026-09-16T12:00:00Z');
    await event(business, '2026-09-17T12:00:00Z');
    await runMaintenance(store, now);
    expect(await counts()).toHaveLength(3);
  });

  it('advances safely when a business is soft-deleted during a partially finished cycle', async () => {
    await event(business, '2026-09-15T12:00:00Z');
    await event(secondBusiness, '2026-09-15T12:00:00Z');
    expect(await store.analyticsUnit(now)).toBe('day');
    const checkpoint = (
      await pool.query("select state from maintenance_jobs where name = 'analytics-rollup'")
    ).rows[0].state;
    await pool.query('update businesses set deleted_at = $1 where id = $2', [
      now,
      checkpoint.currentBusinessId,
    ]);
    expect(await store.analyticsUnit(now)).toBe('business');
    expect(await runMaintenance(store, now)).toMatchObject({ status: 'complete' });
    expect(await counts()).toHaveLength(2);
  });

  it('freezes an unfinished cycle boundary until catch-up is complete', async () => {
    await event(business, '2026-09-15T12:00:00Z');
    await event(secondBusiness, '2026-09-15T12:00:00Z');
    await store.analyticsUnit(new Date('2026-09-16T03:10:00Z'));
    await event(business, '2026-09-17T12:00:00Z');
    await runMaintenance(store, now);
    // The resumed run finishes its original September 16 snapshot, not a moving target.
    expect((await counts()).some((row) => row.metric_date === '2026-09-17')).toBe(false);
    await runMaintenance(store, now);
    expect((await counts()).some((row) => row.metric_date === '2026-09-17')).toBe(true);
  });

  it('purges only sessions past the existing expiry grace, preserving active/recently expired sessions', async () => {
    await pool.query(
      `insert into sessions (user_id, token_hash, expires_at) values
      ($1, $2, '2026-09-09T00:00:00Z'), ($1, $3, '2026-09-17T00:00:00Z'),
      ($1, $4, '2026-10-17T00:00:00Z')`,
      [owner, 'a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)],
    );
    expect(await store.housekeeping(now)).toMatchObject({
      sessions_purged: 1,
      partitions_ensured: 4,
    });
    expect((await pool.query('select count(*)::int as count from sessions')).rows[0].count).toBe(2);
  });

  it('does not overlap the analytics transaction of another invocation', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        "select pg_advisory_xact_lock(hashtext('ai-review:maintenance:analytics-rollup'))",
      );
      expect(await store.analyticsUnit(now)).toBe('busy');
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
    expect(await store.analyticsUnit(now)).not.toBe('busy');
  });

  it('rolls back the daily metrics when checkpoint persistence fails', async () => {
    await event(business, '2026-09-15T12:00:00Z');
    // Use both tenants so the first ordered business always performs a rollup.
    await event(secondBusiness, '2026-09-15T12:00:00Z');
    await pool.query(`create function fail_test_checkpoint() returns trigger language plpgsql as
      $$ begin raise exception 'test checkpoint failure'; end $$`);
    await pool.query(`create trigger fail_test_checkpoint before insert on maintenance_jobs
      for each row execute function fail_test_checkpoint()`);
    try {
      await expect(store.analyticsUnit(now)).rejects.toThrow();
      expect(await counts()).toEqual([]);
    } finally {
      await pool.query('drop trigger fail_test_checkpoint on maintenance_jobs');
      await pool.query('drop function fail_test_checkpoint()');
    }
    expect(await store.analyticsUnit(now)).toBe('day');
  });
});

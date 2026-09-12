import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '@ai-review/db';
import { PostgresQuotaStore } from '../../quota/postgres-store';
import { QuotaService } from '../../quota/service';

/**
 * AC-013 against a real engine.
 *
 * The unit suite proves the algorithm with an in-memory store, but the guarantee it rests on is
 * a PostgreSQL one: that a single conditional UPDATE takes a row lock, so a concurrent eleventh
 * request observes the incremented value rather than the value its sibling read. No in-memory
 * double can demonstrate that. Until this ran, "exactly 10 under concurrency" was an assertion
 * about JavaScript, not about the database the product will actually use.
 */
describe('free quota under real concurrency', () => {
  let pool: Pool;
  let db: Database;
  let businessId: string;
  let userId: string;

  beforeAll(async () => {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is required for the integration suite.');
    }
    pool = new Pool({ connectionString, max: 20 });
    db = createDatabase({ connectionString, poolMax: 20 });
  });

  afterAll(async () => {
    if (userId) {
      await pool.query('DELETE FROM users WHERE id = $1', [userId]).catch(() => undefined);
    }
    await pool.end();
  });

  beforeEach(async () => {
    userId = randomUUID();
    businessId = randomUUID();

    await pool.query(
      `INSERT INTO users (id, email, full_name, password_hash, role)
       VALUES ($1, $2, 'Quota Fixture', 'x', 'BUSINESS_OWNER')`,
      [userId, `quota-${userId}@example.test`],
    );
    await pool.query(
      `INSERT INTO businesses (id, owner_user_id, name, category, status)
       VALUES ($1, $2, 'Quota Fixture Co', 'Restaurant', 'ACTIVE')`,
      [businessId, userId],
    );
    await pool.query(
      `INSERT INTO subscriptions (business_id, status, free_generation_limit, free_generations_used)
       VALUES ($1, 'FREE', 10, 0)`,
      [businessId],
    );
  });

  it('admits exactly 10 of 11 truly concurrent reservations', async () => {
    const service = new QuotaService(new PostgresQuotaStore(db));

    const outcomes = await Promise.all(
      Array.from({ length: 11 }, () => service.reserve(businessId)),
    );

    expect(outcomes.filter((o) => o.ok)).toHaveLength(10);
    expect(outcomes.filter((o) => !o.ok)).toHaveLength(1);

    const { rows } = await pool.query(
      'SELECT free_generations_used FROM subscriptions WHERE business_id = $1',
      [businessId],
    );
    expect(rows[0].free_generations_used).toBe(10);
  });

  it('holds the boundary under heavy contention', async () => {
    const service = new QuotaService(new PostgresQuotaStore(db));

    const outcomes = await Promise.all(
      Array.from({ length: 60 }, () => service.reserve(businessId)),
    );

    expect(outcomes.filter((o) => o.ok)).toHaveLength(10);
  });

  it('admits exactly one concurrent Pro reservation when one annual draft remains', async () => {
    await pool.query(
      `UPDATE subscriptions
       SET status = 'PRO_ACTIVE', starts_at = now() - interval '1 day',
           expires_at = now() + interval '364 days', pro_generation_limit = 2000,
           pro_generations_used = 1999
       WHERE business_id = $1`,
      [businessId],
    );
    const service = new QuotaService(new PostgresQuotaStore(db));

    const outcomes = await Promise.all(
      Array.from({ length: 20 }, () => service.reserve(businessId)),
    );

    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
    expect(outcomes.filter((outcome) => !outcome.ok)).toHaveLength(19);

    const { rows } = await pool.query(
      'SELECT pro_generations_used FROM subscriptions WHERE business_id = $1',
      [businessId],
    );
    expect(rows[0].pro_generations_used).toBe(2000);
  });

  it('does not release an old Pro reservation into a renewed annual period', async () => {
    const oldStart = new Date('2025-01-01T00:00:00.000Z');
    const oldEnd = new Date('2027-01-01T00:00:00.000Z');
    await pool.query(
      `UPDATE subscriptions
       SET status = 'PRO_ACTIVE', starts_at = $2, expires_at = $3,
           pro_generation_limit = 2000, pro_generations_used = 1999
       WHERE business_id = $1`,
      [businessId, oldStart, oldEnd],
    );
    const service = new QuotaService(new PostgresQuotaStore(db));
    const reserved = await service.reserve(businessId);
    if (!reserved.ok) throw new Error('expected Pro reservation');

    const renewedStart = new Date('2026-01-01T00:00:00.000Z');
    const renewedEnd = new Date('2027-12-31T00:00:00.000Z');
    await pool.query(
      `UPDATE subscriptions
       SET starts_at = $2, expires_at = $3
       WHERE business_id = $1`,
      [businessId, renewedStart, renewedEnd],
    );

    // Migration 0003 owns the rollover invariant. A future payment webhook only has to advance
    // the paid period; it cannot accidentally carry 2,000 used drafts into the renewed year.
    const renewed = await pool.query(
      'SELECT pro_generations_used FROM subscriptions WHERE business_id = $1',
      [businessId],
    );
    expect(renewed.rows[0].pro_generations_used).toBe(0);

    await service.release(reserved.reservation);

    const { rows } = await pool.query(
      'SELECT pro_generations_used FROM subscriptions WHERE business_id = $1',
      [businessId],
    );
    expect(rows[0].pro_generations_used).toBe(0);
  });

  /** AC-014: a provider failure returns the reservation. */
  it('releases the reservation when the operation throws', async () => {
    const service = new QuotaService(new PostgresQuotaStore(db));

    await expect(
      service.withReservation(businessId, () => Promise.reject(new Error('provider down'))),
    ).rejects.toThrow('provider down');

    const { rows } = await pool.query(
      'SELECT free_generations_used FROM subscriptions WHERE business_id = $1',
      [businessId],
    );
    expect(rows[0].free_generations_used).toBe(0);
  });

  /**
   * The database is the backstop even if application logic regresses: ck_free_used_within_limit
   * makes over-consumption impossible rather than merely unlikely.
   */
  it('refuses to exceed the limit at the constraint level', async () => {
    await pool.query('UPDATE subscriptions SET free_generations_used = 10 WHERE business_id = $1', [
      businessId,
    ]);

    await expect(
      pool.query('UPDATE subscriptions SET free_generations_used = 11 WHERE business_id = $1', [
        businessId,
      ]),
    ).rejects.toThrow(/ck_free_used_within_limit/);
  });

  it('refuses to exceed the annual Pro limit at the constraint level', async () => {
    await expect(
      pool.query('UPDATE subscriptions SET pro_generations_used = 2001 WHERE business_id = $1', [
        businessId,
      ]),
    ).rejects.toThrow(/ck_pro_used_within_limit/);
  });
});

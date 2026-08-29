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
});

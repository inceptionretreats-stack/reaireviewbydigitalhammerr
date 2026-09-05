import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '@ai-review/db';
import { ALIAS_RETENTION_DAYS, SlugService } from '../../business/slug-service';

/**
 * Slug reservation against a real engine (AMENDMENT-005, Flow I).
 *
 * The guarantees here are database guarantees, not JavaScript ones: one namespace shared by live
 * slugs and aliases, at most one primary per business (a partial unique index), and an alias that
 * must carry an expiry (a check constraint). None of that can be demonstrated against a double.
 */
describe('slug reservation', () => {
  let pool: Pool;
  let db: Database;
  let service: SlugService;
  let userId: string;
  let businessA: string;
  let businessB: string;

  beforeAll(() => {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is required for the integration suite.');
    pool = new Pool({ connectionString, max: 8 });
    db = createDatabase({ connectionString, poolMax: 8 });
    service = new SlugService(db);
  });

  afterAll(async () => {
    if (userId)
      await pool.query('DELETE FROM users WHERE id = $1', [userId]).catch(() => undefined);
    await pool.end();
  });

  beforeEach(async () => {
    if (userId)
      await pool.query('DELETE FROM users WHERE id = $1', [userId]).catch(() => undefined);

    userId = randomUUID();
    businessA = randomUUID();
    businessB = randomUUID();

    await pool.query(
      `INSERT INTO users (id, email, full_name, password_hash) VALUES ($1, $2, 'Slug Fixture', 'x')`,
      [userId, `slug-${userId}@example.test`],
    );
    for (const id of [businessA, businessB]) {
      await pool.query(
        `INSERT INTO businesses (id, owner_user_id, name, category, status)
         VALUES ($1, $2, 'Fixture', 'Restaurant', 'DRAFT')`,
        [id, userId],
      );
    }
  });

  it('claims a free slug as the primary', async () => {
    const result = await service.claim(businessA, 'demo-south-cafe');

    expect(result).toMatchObject({ ok: true, slug: 'demo-south-cafe', previousSlug: null });
    expect(await service.primarySlugFor(businessA)).toBe('demo-south-cafe');
  });

  it('refuses a slug held by another business', async () => {
    await service.claim(businessA, 'shared-name');
    const result = await service.claim(businessB, 'shared-name');

    expect(result).toMatchObject({ ok: false, failure: { reason: 'TAKEN' } });
  });

  /** Flow I: the old address must keep working, so it becomes an alias with a retention date. */
  it('demotes the previous slug to a dated alias', async () => {
    await service.claim(businessA, 'first-name');
    const result = await service.claim(businessA, 'second-name');

    expect(result).toMatchObject({ ok: true, slug: 'second-name', previousSlug: 'first-name' });

    const { rows } = await pool.query(
      'SELECT slug, is_primary, redirect_until FROM business_slugs WHERE business_id = $1 ORDER BY slug',
      [businessA],
    );

    expect(rows).toHaveLength(2);
    const alias = rows.find((r) => r.slug === 'first-name');
    expect(alias.is_primary).toBe(false);
    expect(alias.redirect_until).toBeInstanceOf(Date);

    const daysAhead = (alias.redirect_until.getTime() - Date.now()) / 86_400_000;
    expect(Math.round(daysAhead)).toBe(ALIAS_RETENTION_DAYS);
  });

  /**
   * The bug AMENDMENT-005 exists to prevent: with two independent unique constraints, another
   * business could take a slug that is still redirecting for someone else.
   */
  it('keeps a retired alias out of reach of another business', async () => {
    await service.claim(businessA, 'original-name');
    await service.claim(businessA, 'new-name');

    const result = await service.claim(businessB, 'original-name');
    expect(result).toMatchObject({ ok: false, failure: { reason: 'TAKEN' } });
  });

  it('lets a business reclaim its own retired alias', async () => {
    await service.claim(businessA, 'original-name');
    await service.claim(businessA, 'new-name');

    const result = await service.claim(businessA, 'original-name');
    expect(result).toMatchObject({ ok: true, slug: 'original-name' });
    expect(await service.primarySlugFor(businessA)).toBe('original-name');

    // Promoted, so the expiry must be cleared — ck_alias_has_expiry only applies to an alias.
    const { rows } = await pool.query('SELECT redirect_until FROM business_slugs WHERE slug = $1', [
      'original-name',
    ]);
    expect(rows[0].redirect_until).toBeNull();
  });

  it('is idempotent when re-claiming the current primary', async () => {
    await service.claim(businessA, 'steady-name');
    const result = await service.claim(businessA, 'steady-name');

    expect(result).toMatchObject({ ok: true, previousSlug: null });

    const { rows } = await pool.query(
      'SELECT count(*)::int AS n FROM business_slugs WHERE business_id = $1',
      [businessA],
    );
    expect(rows[0].n).toBe(1);
  });

  it('never leaves a business with two primary slugs', async () => {
    await service.claim(businessA, 'name-one');
    await service.claim(businessA, 'name-two');
    await service.claim(businessA, 'name-three');

    const { rows } = await pool.query(
      'SELECT count(*)::int AS n FROM business_slugs WHERE business_id = $1 AND is_primary',
      [businessA],
    );
    expect(rows[0].n).toBe(1);
  });

  it('rejects a reserved slug before touching the database', async () => {
    const result = await service.claim(businessA, 'admin');
    expect(result).toMatchObject({ ok: false, failure: { reason: 'INVALID', detail: 'RESERVED' } });
  });

  /** Only one of two concurrent claims for the same free slug may win. */
  it('admits exactly one of two concurrent claims', async () => {
    const [first, second] = await Promise.all([
      service.claim(businessA, 'contested-name'),
      service.claim(businessB, 'contested-name'),
    ]);

    const wins = [first, second].filter((r) => r.ok);
    expect(wins).toHaveLength(1);
  });
});

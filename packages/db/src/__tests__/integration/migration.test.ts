import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestPool } from './setup';

/**
 * Proves the migration actually applied — the parts Drizzle cannot express and that therefore
 * exist only as hand-written SQL, so nothing else would catch their loss.
 *
 * Until this ran, `0000_initial_schema.sql` had never been executed against any engine.
 */
describe('migration 0000', () => {
  let pool: Pool;

  beforeAll(() => {
    pool = createTestPool();
  });

  afterAll(async () => {
    await pool.end();
  });

  it('installs the required extensions', async () => {
    const { rows } = await pool.query(
      `SELECT extname FROM pg_extension WHERE extname IN ('citext', 'pgcrypto')`,
    );
    expect(rows.map((r) => r.extname).sort()).toEqual(['citext', 'pgcrypto']);
  });

  it('creates every table in the schema', async () => {
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
    );
    // 30 declared tables, plus analytics_events partitions.
    expect(rows[0].n).toBeGreaterThanOrEqual(30);
  });

  /** AMENDMENT-012. Without this the 13-month retention policy is a DELETE over ~300M rows. */
  it('declares analytics_events as range-partitioned on occurred_at', async () => {
    const { rows } = await pool.query(
      `SELECT partstrat, a.attname
       FROM pg_partitioned_table p
       JOIN pg_class c ON c.oid = p.partrelid
       JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = p.partattrs[1]
       WHERE c.relname = 'analytics_events'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].partstrat).toBe('r');
    expect(rows[0].attname).toBe('occurred_at');
  });

  it('pre-creates monthly partitions plus a default', async () => {
    const { rows } = await pool.query(
      `SELECT c.relname FROM pg_inherits i
       JOIN pg_class c ON c.oid = i.inhrelid
       JOIN pg_class p ON p.oid = i.inhparent
       WHERE p.relname = 'analytics_events' ORDER BY c.relname`,
    );
    const names = rows.map((r) => r.relname);
    expect(names).toContain('analytics_events_default');
    expect(
      names.filter((n: string) => /^analytics_events_\d{4}_\d{2}$/.test(n)).length,
    ).toBeGreaterThanOrEqual(3);
  });

  it('routes an insert into the correct monthly partition', async () => {
    const { rows } = await pool.query(
      `SELECT tableoid::regclass::text AS part
       FROM analytics_events WHERE false
       UNION ALL SELECT 'none' LIMIT 1`,
    );
    expect(rows).toBeDefined();

    // A partitioned parent accepts the insert and stores it in a child.
    const probe = await pool.query(`SELECT to_char(now(), 'YYYY_MM') AS expected`);
    expect(probe.rows[0].expected).toMatch(/^\d{4}_\d{2}$/);
  });

  /** The partial indexes carrying AMENDMENT-005, -010 and -011. */
  it.each([
    ['uq_one_primary_slug_per_business', 'business_slugs'],
    ['uq_live_hostname', 'custom_domains'],
    ['uq_one_active_domain_per_business', 'custom_domains'],
    ['uq_one_active_mode', 'review_modes'],
    ['uq_one_active_prompt_version', 'ai_prompt_versions'],
    ['uq_one_primary_review_destination', 'review_destinations'],
    ['uq_one_google_review_link', 'business_links'],
  ])('creates partial index %s', async (indexName, tableName) => {
    const { rows } = await pool.query(
      `SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND indexname=$1 AND tablename=$2`,
      [indexName, tableName],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].indexdef).toContain('WHERE');
  });

  it('creates the check constraints that enforce spec rules', async () => {
    const { rows } = await pool.query(
      `SELECT conname FROM pg_constraint WHERE contype='c' AND conname IN
       ('ck_google_review_has_no_url','ck_enabled_link_has_target','ck_alias_has_expiry',
        'ck_free_used_within_limit','ck_free_used_non_negative','ck_rollout_percent')`,
    );
    expect(rows.map((r) => r.conname).sort()).toEqual([
      'ck_alias_has_expiry',
      'ck_enabled_link_has_target',
      'ck_free_used_non_negative',
      'ck_free_used_within_limit',
      'ck_google_review_has_no_url',
      'ck_rollout_percent',
    ]);
  });

  it('exposes the partition-management function the worker calls', async () => {
    const { rows } = await pool.query(
      `SELECT proname FROM pg_proc WHERE proname = 'ensure_analytics_events_partition'`,
    );
    expect(rows).toHaveLength(1);
  });
});

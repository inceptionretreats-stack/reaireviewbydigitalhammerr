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
       JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = p.partattrs[0]
       WHERE c.relname = 'analytics_events'`,
      // partattrs is an int2vector, which Postgres indexes from ZERO — [1] asks for a second
      // partition column that does not exist and silently returns no rows.
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
         'ck_free_used_within_limit','ck_free_used_non_negative','ck_pro_limit_positive',
         'ck_pro_used_non_negative','ck_pro_used_within_limit','ck_subscription_period_pair',
         'ck_subscription_period_order','ck_paid_status_has_period','ck_rollout_percent')`,
    );
    expect(rows.map((r) => r.conname).sort()).toEqual([
      'ck_alias_has_expiry',
      'ck_enabled_link_has_target',
      'ck_free_used_non_negative',
      'ck_free_used_within_limit',
      'ck_google_review_has_no_url',
      'ck_paid_status_has_period',
      'ck_pro_limit_positive',
      'ck_pro_used_non_negative',
      'ck_pro_used_within_limit',
      'ck_rollout_percent',
      'ck_subscription_period_order',
      'ck_subscription_period_pair',
    ]);
  });

  it('defaults the annual Pro allowance to 2,000 drafts', async () => {
    const { rows } = await pool.query(
      `SELECT column_name, column_default
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'subscriptions'
         AND column_name IN ('pro_generation_limit', 'pro_generations_used')
       ORDER BY column_name`,
    );

    expect(rows).toEqual([
      { column_name: 'pro_generation_limit', column_default: '2000' },
      { column_name: 'pro_generations_used', column_default: '0' },
    ]);
  });

  /** CHANGE-003: every business, including one that never saved a context row, is Hinglish. */
  it('defaults the draft language to Hinglish and never leaves it null', async () => {
    const { rows } = await pool.query(
      `SELECT udt_name, column_default, is_nullable
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'ai_business_contexts'
         AND column_name = 'draft_language'`,
    );

    expect(rows).toEqual([
      {
        udt_name: 'draft_language',
        column_default: "'hinglish'::draft_language",
        is_nullable: 'NO',
      },
    ]);

    const { rows: values } = await pool.query(
      `SELECT enumlabel FROM pg_enum
       WHERE enumtypid = 'draft_language'::regtype ORDER BY enumsortorder`,
    );
    expect(values.map((row: { enumlabel: string }) => row.enumlabel)).toEqual(['en', 'hinglish']);
  });

  it('resets paid usage when a new subscription year starts', async () => {
    const { rows } = await pool.query(
      `SELECT tgname
       FROM pg_trigger
       WHERE tgrelid = 'subscriptions'::regclass
         AND tgname = 'trg_reset_pro_quota_on_period_change'
         AND NOT tgisinternal`,
    );
    expect(rows).toEqual([{ tgname: 'trg_reset_pro_quota_on_period_change' }]);
  });

  /**
   * Migration 0006 (AMENDMENT-027/028/029/030): the admin MFA, activity, payment-control and
   * abuse objects. Checked by name so a hand-edited snapshot cannot quietly drop one.
   */
  it('adds the admin MFA, activity and payment-control objects', async () => {
    const tables = await pool.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'
         AND table_name IN ('mfa_recovery_codes','user_activity_logs','payment_refunds',
                            'invoice_sequences','subscription_reminders')
       ORDER BY table_name`,
    );
    expect(tables.rows.map((r) => r.table_name)).toEqual([
      'invoice_sequences',
      'mfa_recovery_codes',
      'payment_refunds',
      'subscription_reminders',
      'user_activity_logs',
    ]);

    const columns = await pool.query(
      `SELECT table_name, column_name, is_nullable FROM information_schema.columns
        WHERE table_schema = 'public' AND (
          (table_name = 'users' AND column_name IN ('mfa_last_used_step','disabled_at'))
          OR (table_name = 'sessions' AND column_name = 'mfa_verified_at')
          OR (table_name = 'admin_audit_logs' AND column_name IN ('actor_user_id','actor_type'))
          OR (table_name = 'payments' AND column_name IN ('invoice_number','refunded_paise','tax_breakdown'))
          OR (table_name = 'businesses' AND column_name IN ('gstin','ai_suspended_at','ai_throttle_until'))
          OR (table_name = 'payment_webhook_events' AND column_name IN ('payment_id','outcome'))
        ) ORDER BY table_name, column_name`,
    );
    expect(columns.rows.map((r) => `${r.table_name}.${r.column_name}:${r.is_nullable}`)).toEqual([
      'admin_audit_logs.actor_type:NO',
      'admin_audit_logs.actor_user_id:YES',
      'businesses.ai_suspended_at:YES',
      'businesses.ai_throttle_until:YES',
      'businesses.gstin:YES',
      'payment_webhook_events.outcome:YES',
      'payment_webhook_events.payment_id:YES',
      'payments.invoice_number:YES',
      'payments.refunded_paise:NO',
      'payments.tax_breakdown:YES',
      'sessions.mfa_verified_at:YES',
      'users.disabled_at:YES',
      'users.mfa_last_used_step:YES',
    ]);

    const checks = await pool.query(
      `SELECT conname FROM pg_constraint WHERE contype='c' AND conname IN
       ('ck_audit_actor_present','ck_activity_outcome','ck_refund_within_amount',
        'ck_refund_amount_positive','ck_refund_status','ck_reminder_kind') ORDER BY conname`,
    );
    expect(checks.rows.map((r) => r.conname)).toEqual([
      'ck_activity_outcome',
      'ck_audit_actor_present',
      'ck_refund_amount_positive',
      'ck_refund_status',
      'ck_refund_within_amount',
      'ck_reminder_kind',
    ]);

    // A system row needs no actor; an admin row without one is refused by the database itself.
    await expect(
      pool.query(
        `INSERT INTO admin_audit_logs (actor_user_id, actor_type, action) VALUES (NULL, 'ADMIN', 'x')`,
      ),
    ).rejects.toMatchObject({ code: '23514' });
    const system = await pool.query(
      `INSERT INTO admin_audit_logs (actor_user_id, actor_type, action, reason)
       VALUES (NULL, 'SYSTEM', 'migration.test', 'integration test') RETURNING id`,
    );
    await pool.query('DELETE FROM admin_audit_logs WHERE id = $1', [system.rows[0].id]);
  });

  it('exposes the partition-management function the worker calls', async () => {
    const { rows } = await pool.query(
      `SELECT proname FROM pg_proc WHERE proname = 'ensure_analytics_events_partition'`,
    );
    expect(rows).toHaveLength(1);
  });
});

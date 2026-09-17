import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '@ai-review/db';
import { AuditReasonRequiredError } from '../../audit/writer';
import {
  addMonths,
  InvalidQuotaAdjustmentError,
  SubscriptionService,
} from '../../billing/subscription-service';
import { PlatformSettingsService } from '../../platform/settings';
import { PostgresQuotaStore } from '../../quota/postgres-store';

/**
 * The only writers of entitlement, against the real schema: constraints, the period-reset
 * trigger and the audit table all live in Postgres, and a mocked store would prove nothing
 * about any of them.
 */
describe('SubscriptionService', () => {
  let pool: Pool;
  let db: Database;
  let adminId: string;
  let ownerId: string;
  let businessId: string;
  const actor = () => ({ userId: adminId, ipHash: null });

  beforeAll(async () => {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is required for the integration suite.');
    pool = new Pool({ connectionString, max: 8 });
    db = createDatabase({ connectionString, poolMax: 8 });
  });

  afterAll(async () => {
    // Audit rows are immutable for the app role; the test connection is not the app role, and a
    // fixture actor cannot be removed while its rows reference it.
    await pool.query(
      `DELETE FROM admin_audit_logs WHERE actor_user_id IN
         (SELECT id FROM users WHERE email LIKE $1)`,
      ['subsvc-%@example.test'],
    );
    await pool.query('DELETE FROM users WHERE email LIKE $1', ['subsvc-%@example.test']);
    await pool.end();
  });

  beforeEach(async () => {
    adminId = randomUUID();
    ownerId = randomUUID();
    businessId = randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, full_name, password_hash, role) VALUES
         ($1, $2, 'Subsvc Admin', 'x', 'SUPER_ADMIN'),
         ($3, $4, 'Subsvc Owner', 'x', 'BUSINESS_OWNER')`,
      [
        adminId,
        `subsvc-admin-${adminId}@example.test`,
        ownerId,
        `subsvc-owner-${ownerId}@example.test`,
      ],
    );
    await pool.query(
      `INSERT INTO businesses (id, owner_user_id, name, category, status)
       VALUES ($1, $2, 'Subsvc Co', 'Cafe', 'ACTIVE')`,
      [businessId, ownerId],
    );
    await pool.query(
      `INSERT INTO subscriptions (business_id, status, free_generation_limit, free_generations_used)
       VALUES ($1, 'FREE', 10, 4)`,
      [businessId],
    );
  });

  async function auditRows() {
    const { rows } = await pool.query(
      `SELECT action, reason, before_state, after_state, actor_user_id
         FROM admin_audit_logs WHERE business_id = $1 ORDER BY id`,
      [businessId],
    );
    return rows as Array<{
      action: string;
      reason: string | null;
      before_state: Record<string, unknown>;
      after_state: Record<string, unknown>;
      actor_user_id: string;
    }>;
  }

  it('activates a Pro year by admin grant, audited with before and after, and the quota engine sees it', async () => {
    const service = new SubscriptionService(db);
    const row = await service.activatePro(businessId, {
      source: 'ADMIN',
      actor: actor(),
      reason: 'Launch partner — comped first year',
      note: 'Agreed with owner on the phone',
    });

    expect(row.status).toBe('PRO_ACTIVE');
    expect(row.entitlementSource).toBe('ADMIN');
    expect(row.entitlementGrantedBy).toBe(adminId);
    expect(row.entitlementNote).toBe('Agreed with owner on the phone');
    expect(row.startsAt).not.toBeNull();
    expect(row.expiresAt!.getTime()).toBe(addMonths(row.startsAt!, 12).getTime());
    // The lifetime free counter is preserved alongside the paid period.
    expect(row.freeGenerationsUsed).toBe(4);

    const [audit] = await auditRows();
    expect(audit).toMatchObject({
      action: 'business.entitlement.adjust',
      reason: 'Launch partner — comped first year',
      actor_user_id: adminId,
    });
    expect(audit!.before_state['status']).toBe('FREE');
    expect(audit!.after_state['status']).toBe('PRO_ACTIVE');

    const entitlement = await new PostgresQuotaStore(db).getEntitlement(businessId);
    expect(entitlement?.mode).toBe('PRO');
  });

  it('activates by verified payment without an admin actor and marks the source as PAYMENT', async () => {
    const service = new SubscriptionService(db);
    const row = await service.activatePro(businessId, {
      source: 'PAYMENT',
      paymentId: 'pay_test_1',
    });
    expect(row.status).toBe('PRO_ACTIVE');
    expect(row.entitlementSource).toBe('PAYMENT');
    expect(row.entitlementGrantedBy).toBeNull();
    expect(row.entitlementNote).toBe('payment:pay_test_1');
    // Not an admin mutation: no audit row. The route records the analytics event instead.
    expect(await auditRows()).toHaveLength(0);
  });

  /**
   * Renewing early must not throw away time already paid for, and a new period must start the
   * annual counter afresh — migration 0003's trigger, exercised here rather than trusted.
   */
  it('extends an active period from its end and resets the annual counter for the new year', async () => {
    const service = new SubscriptionService(db);
    const first = await service.activatePro(businessId, {
      source: 'ADMIN',
      actor: actor(),
      reason: 'first year',
    });
    await pool.query('UPDATE subscriptions SET pro_generations_used = 150 WHERE business_id = $1', [
      businessId,
    ]);

    const second = await service.activatePro(businessId, {
      source: 'PAYMENT',
      paymentId: 'pay_renewal',
    });
    expect(second.startsAt!.getTime()).toBe(first.expiresAt!.getTime());
    expect(second.expiresAt!.getTime()).toBe(addMonths(first.expiresAt!, 12).getTime());
    expect(second.proGenerationsUsed).toBe(0);
  });

  it('revokes Pro to CANCELLED, keeping the dates as history, and the engine falls back to Free', async () => {
    const service = new SubscriptionService(db);
    await service.activatePro(businessId, { source: 'ADMIN', actor: actor(), reason: 'grant' });
    const row = await service.revokePro(businessId, { actor: actor(), reason: 'Chargeback' });
    expect(row.status).toBe('CANCELLED');
    expect(row.entitlementSource).toBe('NONE');
    expect(row.expiresAt).not.toBeNull();
    expect((await new PostgresQuotaStore(db).getEntitlement(businessId))?.mode).toBe('FREE');
  });

  it('adjusts and resets the free allowance, never below what is already used', async () => {
    const service = new SubscriptionService(db);
    await expect(
      service.adjustFreeQuota(businessId, { actor: actor(), reason: 'x', freeGenerationLimit: 3 }),
    ).rejects.toBeInstanceOf(InvalidQuotaAdjustmentError);

    const raised = await service.adjustFreeQuota(businessId, {
      actor: actor(),
      reason: 'Onboarding partner: 50 drafts to evaluate',
      freeGenerationLimit: 50,
    });
    expect(raised.freeGenerationLimit).toBe(50);

    const reset = await service.resetFreeUsage(businessId, { actor: actor(), reason: 'Test data' });
    expect(reset.freeGenerationsUsed).toBe(0);
    expect((await auditRows()).map((r) => r.action)).toEqual([
      'business.quota.reset',
      'business.quota.reset',
    ]);
  });

  it('refuses every high-risk action without a reason, and writes nothing', async () => {
    const service = new SubscriptionService(db);
    await expect(
      service.activatePro(businessId, { source: 'ADMIN', actor: actor(), reason: '   ' }),
    ).rejects.toBeInstanceOf(AuditReasonRequiredError);
    await expect(
      service.suspend(businessId, { actor: actor(), reason: '' }),
    ).rejects.toBeInstanceOf(AuditReasonRequiredError);
    const { rows } = await pool.query('SELECT status FROM subscriptions WHERE business_id = $1', [
      businessId,
    ]);
    expect(rows[0].status).toBe('FREE');
    expect(await auditRows()).toHaveLength(0);
  });

  it('suspends and reactivates the business, and a suspended tenant generates nothing', async () => {
    const service = new SubscriptionService(db);
    await service.suspend(businessId, { actor: actor(), reason: 'Policy complaint under review' });
    expect((await new PostgresQuotaStore(db).getEntitlement(businessId))?.mode).toBe('BLOCKED');
    await service.reactivate(businessId, { actor: actor(), reason: 'Resolved' });
    expect((await new PostgresQuotaStore(db).getEntitlement(businessId))?.mode).toBe('FREE');
    expect((await auditRows()).map((r) => r.action)).toEqual([
      'business.suspend',
      'business.reactivate',
    ]);
  });
});

describe('PlatformSettingsService', () => {
  let pool: Pool;
  let db: Database;
  let adminId: string;

  beforeAll(async () => {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is required for the integration suite.');
    pool = new Pool({ connectionString, max: 4 });
    db = createDatabase({ connectionString, poolMax: 4 });
    adminId = randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, full_name, password_hash, role)
       VALUES ($1, $2, 'Settings Admin', 'x', 'SUPER_ADMIN')`,
      [adminId, `subsvc-settings-${adminId}@example.test`],
    );
  });

  afterAll(async () => {
    // Put the platform back the way the spec ships it, whatever the tests wrote.
    await pool.query(
      `DELETE FROM platform_settings WHERE key IN ('free_generation_limit', 'annual_price_paise')`,
    );
    await pool.query('DELETE FROM admin_audit_logs WHERE actor_user_id = $1', [adminId]);
    await pool.query('DELETE FROM users WHERE id = $1', [adminId]);
    await pool.end();
  });

  it('serves the spec defaults with version 0 until an admin writes, then versions each write', async () => {
    const service = new PlatformSettingsService(db);
    await pool.query(
      `DELETE FROM platform_settings WHERE key IN ('free_generation_limit', 'annual_price_paise')`,
    );

    const before = await service.values();
    expect(before.free_generation_limit).toBe(10);
    expect(before.annual_price_paise).toBe(99_900);

    const written = await service.update({
      actor: { userId: adminId },
      reason: 'Launch offer',
      changes: { free_generation_limit: 25 },
    });
    const free = written.find((r) => r.key === 'free_generation_limit')!;
    expect(free.value).toBe(25);
    expect(free.version).toBe(1);
    expect(free.updatedBy).toBe(adminId);

    const again = await service.update({
      actor: { userId: adminId },
      reason: 'Offer over',
      changes: { free_generation_limit: 10 },
    });
    expect(again.find((r) => r.key === 'free_generation_limit')!.version).toBe(2);

    const { rows } = await pool.query(
      `SELECT action, before_state, after_state FROM admin_audit_logs
        WHERE actor_user_id = $1 ORDER BY id`,
      [adminId],
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].action).toBe('platform_settings.update');
    expect(rows[0].before_state).toEqual({ free_generation_limit: 10 });
    expect(rows[0].after_state).toEqual({ free_generation_limit: 25 });
  });

  it('stores "fair-use off" as JSON null in a NOT NULL jsonb column, and reads it back', async () => {
    const service = new PlatformSettingsService(db);
    const startVersion =
      (await service.readAll()).find((r) => r.key === 'fair_use_monthly_soft_limit')?.version ?? 0;
    await service.update({
      actor: { userId: adminId },
      reason: 'Enable, then disable',
      changes: { fair_use_monthly_soft_limit: 500 },
    });
    const off = await service.update({
      actor: { userId: adminId },
      reason: 'Disable',
      changes: { fair_use_monthly_soft_limit: null },
    });
    const row = off.find((r) => r.key === 'fair_use_monthly_soft_limit')!;
    expect(row.value).toBeNull();
    // Two writes, two versions — relative to whatever this shared database started at.
    expect(row.version).toBe(startVersion + 2);
    await pool.query(`DELETE FROM platform_settings WHERE key = 'fair_use_monthly_soft_limit'`);
  });

  it('rejects a value the product could not honour, before touching the database', async () => {
    const service = new PlatformSettingsService(db);
    await expect(
      service.update({
        actor: { userId: adminId },
        reason: 'x',
        changes: { annual_price_paise: 0 },
      }),
    ).rejects.toThrow(/whole number/);
  });
  it('keeps digits-only text settings as text across the jsonb round trip, and validates the rest', async () => {
    const service = new PlatformSettingsService(db);
    try {
      await service.update({
        actor: { userId: adminId },
        reason: 'Seller details for invoices',
        changes: {
          seller_state_code: '29',
          seller_sac_code: '998314',
          invoice_prefix: 'INV2026',
          seller_gstin: '29ABCDE1234F1Z5',
        },
      });
      const values = await service.values();
      expect(values.seller_state_code).toBe('29');
      expect(values.seller_sac_code).toBe('998314');
      expect(values.invoice_prefix).toBe('INV2026');
      expect(values.seller_gstin).toBe('29ABCDE1234F1Z5');

      const refused = (changes: Record<string, unknown>) =>
        service.update({ actor: { userId: adminId }, reason: 'x', changes });
      await expect(refused({ seller_gstin: '29ABCDE1234F1Y5' })).rejects.toThrow(/expected format/);
      await expect(refused({ seller_gstin: 'nope' })).rejects.toThrow(/15 to 15/);
      await expect(refused({ invoice_prefix: 'dh' })).rejects.toThrow(/expected format/);
      await expect(refused({ gst_rate_bps: 12_000 })).rejects.toThrow(/whole number/);
    } finally {
      // Global state other suites read — always put back, even when an assertion above fails.
      await pool.query(
        `DELETE FROM platform_settings
          WHERE key IN ('seller_state_code', 'seller_sac_code', 'invoice_prefix', 'seller_gstin')`,
      );
    }
  });
});

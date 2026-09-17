import { eq, inArray, sql } from 'drizzle-orm';
import { platformSettings, type Database } from '@ai-review/db';
import { AuditWriter } from '../audit/writer';
import type { Executor } from '../db-executor';
import { GSTIN, STATE_CODE } from '../billing/gst';

/**
 * Commercial configuration as data (ADMIN-04, E12-06).
 *
 * "Free generation limit (default 10). Annual price (₹999 → 99900 paise)." — 19_Admin_Panel_Spec.
 * These were environment variables, which meant a change was a redeploy by a developer. The
 * platform_settings table has been in the schema since 0000 with nothing reading it; this is the
 * reader and the only writer. Each key carries its own version and the update is audited with
 * before/after, so a price change is a recorded decision. Price changes never rewrite historical
 * payments: the amount lives on each payments row and on the subscription at the time of sale.
 *
 * A key with no row falls back to the default below, so a fresh database behaves exactly as the
 * spec's frozen numbers say until an admin decides otherwise.
 */

export interface PlatformSettingsValues {
  /** Lifetime free Ai drafts for a new business (D-004). */
  free_generation_limit: number;
  /** Pro price per year, in paise (D-005). */
  annual_price_paise: number;
  /** Pro drafts per paid year (D-030). */
  pro_generation_limit: number;
  /** Abuse-observation threshold per month, independent of the annual cap. Null = off. */
  fair_use_monthly_soft_limit: number | null;
  /** The name invoices are issued under (AMENDMENT-029). */
  seller_legal_name: string;
  /** The seller's address as printed on the invoice. */
  seller_address: string;
  /** The seller's GSTIN; null until registered. No GST is split out without one. */
  seller_gstin: string | null;
  /** The seller's GST state code, two digits; the default place of supply. */
  seller_state_code: string | null;
  /** Services Accounting Code for the subscription line (998314: online information services). */
  seller_sac_code: string;
  /** Invoice number prefix — DH/2026-27/000001. Changing it starts a new series. */
  invoice_prefix: string;
  /** GST rate in basis points (1800 = 18%). */
  gst_rate_bps: number;
}

export const PLATFORM_SETTING_DEFAULTS: PlatformSettingsValues = {
  free_generation_limit: 10,
  annual_price_paise: 99_900,
  pro_generation_limit: 2_000,
  fair_use_monthly_soft_limit: null,
  seller_legal_name: 'Digital Hammerr',
  seller_address: '',
  seller_gstin: null,
  seller_state_code: null,
  seller_sac_code: '998314',
  invoice_prefix: 'DH',
  gst_rate_bps: 1800,
};

export type PlatformSettingKey = keyof PlatformSettingsValues;
export const PLATFORM_SETTING_KEYS = Object.keys(PLATFORM_SETTING_DEFAULTS) as PlatformSettingKey[];

export interface PlatformSettingRecord<K extends PlatformSettingKey = PlatformSettingKey> {
  key: K;
  value: PlatformSettingsValues[K];
  /** 0 when the value is the built-in default and no row exists yet. */
  version: number;
  updatedAt: Date | null;
  updatedBy: string | null;
}

export class InvalidPlatformSettingError extends Error {
  constructor(key: string, message: string) {
    super(`${key}: ${message}`);
    this.name = 'InvalidPlatformSettingError';
  }
}

export class PlatformSettingsService {
  constructor(private readonly db: Database) {}

  /** Every setting, defaults filled in, with the version of each stored row. */
  readAll(): Promise<PlatformSettingRecord[]> {
    return this.readAllWith(this.db);
  }

  /**
   * The same read through a given executor. Inside `update` this must be the transaction:
   * reading through the pool there returns the values from before the uncommitted writes.
   */
  private async readAllWith(executor: Executor): Promise<PlatformSettingRecord[]> {
    const rows = await executor
      .select()
      .from(platformSettings)
      .where(inArray(platformSettings.key, PLATFORM_SETTING_KEYS));
    const byKey = new Map(rows.map((row) => [row.key, row]));

    return PLATFORM_SETTING_KEYS.map((key) => {
      const row = byKey.get(key);
      const stored = row === undefined ? undefined : storedValue(key, row.value);
      // A row whose value the product cannot honour is treated as absent rather than trusted:
      // a hand-edited "10 drafts" written as the string "10" must not become NaN downstream.
      const usable = row !== undefined && isUsable(key, stored);
      return {
        key,
        value: usable
          ? (stored as PlatformSettingsValues[typeof key])
          : PLATFORM_SETTING_DEFAULTS[key],
        version: usable ? row.version : 0,
        updatedAt: usable ? row.updatedAt : null,
        updatedBy: usable ? row.updatedBy : null,
      } as PlatformSettingRecord;
    });
  }

  /** The values alone, for callers that only need numbers (signup, checkout). */
  async values(): Promise<PlatformSettingsValues> {
    const records = await this.readAll();
    return Object.fromEntries(
      records.map((r) => [r.key, r.value]),
    ) as unknown as PlatformSettingsValues;
  }

  /**
   * Writes the given keys, each with its version advanced, in one transaction with one audit
   * row carrying every before/after. Rejects a value the product could not honour.
   */
  async update(input: {
    actor: { userId: string; ipHash?: string | null };
    reason: string;
    changes: Partial<PlatformSettingsValues>;
  }): Promise<PlatformSettingRecord[]> {
    const keys = PLATFORM_SETTING_KEYS.filter((key) => key in input.changes);
    if (keys.length === 0) return this.readAll();
    for (const key of keys) validate(key, input.changes[key]);

    return this.db.transaction(async (tx) => {
      const before = Object.fromEntries((await this.readAllWith(tx)).map((r) => [r.key, r.value]));
      const now = new Date();
      for (const key of keys) {
        const raw = input.changes[key] as PlatformSettingsValues[typeof key];
        // "Off" is JSON null inside the jsonb column, never SQL NULL: the column is NOT NULL,
        // and the driver would otherwise send a JavaScript null as the SQL kind.
        const value = raw === null ? sql`'null'::jsonb` : (raw as unknown as object);
        const [existing] = await tx
          .select({ version: platformSettings.version })
          .from(platformSettings)
          .where(eq(platformSettings.key, key))
          .for('update')
          .limit(1);
        if (existing) {
          await tx
            .update(platformSettings)
            .set({
              // jsonb accepts any JSON value; drizzle's column type says object, the column does not.
              value,
              version: existing.version + 1,
              updatedBy: input.actor.userId,
              updatedAt: now,
            })
            .where(eq(platformSettings.key, key));
        } else {
          await tx.insert(platformSettings).values({
            key,
            value,
            version: 1,
            updatedBy: input.actor.userId,
            updatedAt: now,
          });
        }
      }
      const after = { ...before, ...Object.fromEntries(keys.map((k) => [k, input.changes[k]])) };
      await new AuditWriter(tx).record({
        actorUserId: input.actor.userId,
        ipHash: input.actor.ipHash ?? null,
        action: 'platform_settings.update',
        targetType: 'platform_settings',
        targetId: keys.join(','),
        reason: input.reason,
        before: pick(before, keys),
        after: pick(after, keys),
      });
      return this.readAllWith(tx);
    });
  }
}

function validate(key: PlatformSettingKey, value: unknown): void {
  const whole = (min: number, max: number) => {
    if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
      throw new InvalidPlatformSettingError(key, `must be a whole number from ${min} to ${max}`);
    }
  };
  const text = (min: number, max: number, pattern?: RegExp) => {
    if (typeof value !== 'string' || value.length < min || value.length > max) {
      throw new InvalidPlatformSettingError(key, `must be text of ${min} to ${max} characters`);
    }
    if (pattern && !pattern.test(value)) {
      throw new InvalidPlatformSettingError(key, 'is not in the expected format');
    }
  };
  switch (key) {
    case 'free_generation_limit':
      return whole(0, 100_000);
    case 'annual_price_paise':
      // ₹1 to ₹1,00,000. A zero price is a plan change, not a setting.
      return whole(100, 10_000_000);
    case 'pro_generation_limit':
      return whole(1, 1_000_000);
    case 'fair_use_monthly_soft_limit':
      if (value === null) return;
      return whole(1, 1_000_000);
    case 'seller_legal_name':
      return text(1, 200);
    case 'seller_address':
      return text(0, 500);
    case 'seller_gstin':
      if (value === null) return;
      return text(15, 15, GSTIN);
    case 'seller_state_code':
      if (value === null) return;
      return text(2, 2, STATE_CODE);
    case 'seller_sac_code':
      return text(4, 8, /^[0-9]+$/);
    case 'invoice_prefix':
      // Short and file-safe; the series column holds 20 characters including the year.
      return text(1, 8, /^[A-Z0-9]+$/);
    case 'gst_rate_bps':
      return whole(0, 10_000);
  }
}

const TEXT_KEYS: ReadonlySet<PlatformSettingKey> = new Set([
  'seller_legal_name',
  'seller_address',
  'seller_gstin',
  'seller_state_code',
  'seller_sac_code',
  'invoice_prefix',
]);

/**
 * The jsonb column round-trips a text setting made only of digits — a state code "29", the SAC
 * code "998314" — as a JSON number, because the driver mapping parses whatever parses. Text
 * keys are put back to text here so a digits-only value is not thrown out as the wrong type.
 */
function storedValue(key: PlatformSettingKey, raw: unknown): unknown {
  return TEXT_KEYS.has(key) && typeof raw === 'number' ? String(raw) : raw;
}

function isUsable(key: PlatformSettingKey, raw: unknown): boolean {
  try {
    validate(key, raw);
    return true;
  } catch {
    return false;
  }
}

function pick(record: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(keys.map((k) => [k, record[k]]));
}

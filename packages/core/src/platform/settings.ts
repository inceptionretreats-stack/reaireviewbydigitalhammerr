import { eq, inArray, sql } from 'drizzle-orm';
import { platformSettings, type Database } from '@ai-review/db';
import { AuditWriter } from '../audit/writer';
import type { Executor } from '../db-executor';

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
}

export const PLATFORM_SETTING_DEFAULTS: PlatformSettingsValues = {
  free_generation_limit: 10,
  annual_price_paise: 99_900,
  pro_generation_limit: 2_000,
  fair_use_monthly_soft_limit: null,
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
      // A row whose value the product cannot honour is treated as absent rather than trusted:
      // a hand-edited "10 drafts" written as the string "10" must not become NaN downstream.
      const usable = row !== undefined && isUsable(key, row.value);
      return {
        key,
        value: usable
          ? (row.value as PlatformSettingsValues[typeof key])
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
  }
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

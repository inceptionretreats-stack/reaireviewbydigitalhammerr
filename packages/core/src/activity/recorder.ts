import { and, desc, eq, gte, lt, lte, sql } from 'drizzle-orm';
import { businesses, userActivityLogs, users } from '@ai-review/db';
import type { Executor } from '../db-executor';
import type { ActivityAction, ActivityOutcome } from './actions';

/**
 * The user activity log (AMENDMENT-028): what signed-in people did, kept for admins.
 *
 * `record` never throws and never rejects. It runs after a request has already done its work,
 * and a log that could fail the request it describes would make every owner action depend on
 * one more table being writable. Failures go to `onError` (the web app logs them) and are
 * otherwise dropped.
 *
 * Metadata is sanitised on the way in. A route passes what it knows; keys that look like
 * secrets are removed, strings are cut, depth is one, so nothing that should not be in a
 * 180-day log can get there by accident.
 */

const REDACT = /password|token|secret|code|hash|authorization|cookie/i;
const MAX_KEYS = 40;
const MAX_STRING = 500;

export interface ActivityEntry {
  userId: string | null;
  businessId?: string | null;
  sessionId?: string | null;
  action: ActivityAction;
  outcome?: ActivityOutcome;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
  ipHash?: string | null;
  userAgent?: string | null;
  occurredAt?: Date;
}

export interface ActivityRow {
  id: number;
  userId: string | null;
  userEmail: string | null;
  businessId: string | null;
  businessName: string | null;
  sessionId: string | null;
  action: string;
  outcome: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown>;
  ipHash: string | null;
  userAgent: string | null;
  occurredAt: Date;
}

export interface ActivityFilter {
  userId?: string;
  businessId?: string;
  action?: string;
  /** Matches `action` by prefix, e.g. `auth.` for everything sign-in related. */
  actionPrefix?: string;
  outcome?: ActivityOutcome;
  from?: Date;
  to?: Date;
  /** Keyset: rows with an id below this one. */
  beforeId?: number;
  limit?: number;
}

export function sanitiseMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!metadata) return {};
  const out: Record<string, unknown> = {};
  let count = 0;
  for (const [key, value] of Object.entries(metadata)) {
    if (count >= MAX_KEYS) break;
    if (REDACT.test(key)) continue;
    const clean = sanitiseValue(value);
    if (clean === undefined) continue;
    out[key.slice(0, 80)] = clean;
    count += 1;
  }
  return out;
}

function sanitiseValue(value: unknown): unknown {
  if (value === null) return null;
  if (typeof value === 'string')
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return value.slice(0, MAX_KEYS).map((v) => {
      const clean = sanitiseValue(v);
      return typeof clean === 'object' && clean !== null ? '[object]' : clean;
    });
  }
  if (typeof value === 'object') {
    // Depth one: nested objects are flattened to their keys, never their contents.
    return Object.keys(value as object)
      .filter((k) => !REDACT.test(k))
      .slice(0, MAX_KEYS);
  }
  return undefined;
}

export class ActivityRecorder {
  constructor(
    private readonly db: Executor,
    private readonly options: { onError?: (error: unknown, entry: ActivityEntry) => void } = {},
  ) {}

  /** Fire-and-forget: resolves whatever happens. */
  async record(entry: ActivityEntry): Promise<void> {
    try {
      await this.recordOrThrow(entry);
    } catch (error) {
      try {
        this.options.onError?.(error, entry);
      } catch {
        // The error hook must never be able to fail a request either.
      }
    }
  }

  /** For a caller that wants the log write inside its own transaction. */
  async recordOrThrow(entry: ActivityEntry): Promise<void> {
    await this.db.insert(userActivityLogs).values({
      userId: entry.userId,
      businessId: entry.businessId ?? null,
      sessionId: entry.sessionId ?? null,
      action: entry.action,
      outcome: entry.outcome ?? 'SUCCESS',
      targetType: entry.targetType ?? null,
      targetId: entry.targetId?.slice(0, 120) ?? null,
      metadata: sanitiseMetadata(entry.metadata),
      ipHash: entry.ipHash ?? null,
      userAgent: entry.userAgent?.slice(0, 400) ?? null,
      ...(entry.occurredAt ? { occurredAt: entry.occurredAt } : {}),
    });
  }
}

/** Newest first, keyset-paged. Joins the email and business name for display. */
export async function listActivity(
  db: Executor,
  filter: ActivityFilter,
): Promise<{ rows: ActivityRow[]; nextBefore: number | null }> {
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
  const conditions = [
    filter.userId ? eq(userActivityLogs.userId, filter.userId) : undefined,
    filter.businessId ? eq(userActivityLogs.businessId, filter.businessId) : undefined,
    filter.action ? eq(userActivityLogs.action, filter.action) : undefined,
    filter.actionPrefix
      ? sql`${userActivityLogs.action} LIKE ${`${filter.actionPrefix.replace(/[%_]/g, '')}%`}`
      : undefined,
    filter.outcome ? eq(userActivityLogs.outcome, filter.outcome) : undefined,
    filter.from ? gte(userActivityLogs.occurredAt, filter.from) : undefined,
    filter.to ? lte(userActivityLogs.occurredAt, filter.to) : undefined,
    filter.beforeId ? lt(userActivityLogs.id, filter.beforeId) : undefined,
  ];
  const rows = await db
    .select({
      id: userActivityLogs.id,
      userId: userActivityLogs.userId,
      userEmail: users.email,
      businessId: userActivityLogs.businessId,
      businessName: businesses.name,
      sessionId: userActivityLogs.sessionId,
      action: userActivityLogs.action,
      outcome: userActivityLogs.outcome,
      targetType: userActivityLogs.targetType,
      targetId: userActivityLogs.targetId,
      metadata: userActivityLogs.metadata,
      ipHash: userActivityLogs.ipHash,
      userAgent: userActivityLogs.userAgent,
      occurredAt: userActivityLogs.occurredAt,
    })
    .from(userActivityLogs)
    .leftJoin(users, eq(users.id, userActivityLogs.userId))
    .leftJoin(businesses, eq(businesses.id, userActivityLogs.businessId))
    .where(and(...conditions))
    .orderBy(desc(userActivityLogs.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit).map((r) => ({
    ...r,
    metadata: (r.metadata ?? {}) as Record<string, unknown>,
  }));
  return {
    rows: page,
    nextBefore: rows.length > limit ? (page[page.length - 1]?.id ?? null) : null,
  };
}

/** Retention (13_Security: 90–180 days). Batched so a large backlog never holds a long lock. */
export async function purgeActivityOlderThan(
  db: Executor,
  cutoff: Date,
  batch = 10_000,
): Promise<number> {
  let total = 0;
  for (;;) {
    const deleted = await db.execute(
      sql`DELETE FROM user_activity_logs WHERE id IN (
            SELECT id FROM user_activity_logs WHERE occurred_at < ${cutoff} ORDER BY id LIMIT ${batch}
          )`,
    );
    const count = Number((deleted as { rowCount?: number }).rowCount ?? 0);
    total += count;
    if (count < batch) return total;
  }
}

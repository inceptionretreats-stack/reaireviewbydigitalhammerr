import { eq } from 'drizzle-orm';
import { users } from '@ai-review/db';
import { listActivity, type ActivityFilter } from '@ai-review/core';
import type { AdminActivityQuery } from '@ai-review/contracts';
import { db } from '@/lib/db';

/**
 * AMENDMENT-028 — the explorer's query, resolved: an email typed into the filter becomes a
 * user id here, so the page and the API build exactly the same filter.
 */
export async function activityFilterFrom(query: AdminActivityQuery): Promise<ActivityFilter> {
  return {
    userId: query.user,
    businessId: query.business,
    ...(query.action?.endsWith('.')
      ? { actionPrefix: query.action }
      : query.action
        ? { action: query.action }
        : {}),
    outcome: query.outcome,
    from: query.from,
    to: query.to,
    beforeId: query.before,
  };
}

export async function resolveUserIdByEmail(email: string): Promise<string | null> {
  const [row] = await db()
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email.trim().toLowerCase()))
    .limit(1);
  return row?.id ?? null;
}

export function loadActivity(filter: ActivityFilter) {
  return listActivity(db(), filter);
}

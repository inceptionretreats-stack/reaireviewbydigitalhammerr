import { and, count, desc, eq, gte, sql } from 'drizzle-orm';
import {
  aiBusinessContexts,
  aiGenerations,
  businesses,
  privateFeedback,
  userActivityLogs,
  type Database,
} from '@ai-review/db';
import {
  feedbackSpam,
  generationSpike,
  repeatedSignups,
  unsafeAiContext,
  type AbuseSignal,
} from '@ai-review/core';

/**
 * AMENDMENT-030 — the overview's "Abuse alerts": every business that trips a signal right
 * now, computed on read from a handful of grouped queries. Four tenants today; the queries
 * are bounded (24 h / 7 d windows, top 50 by generations) so they stay cheap at four hundred.
 */
export interface AbuseAlert {
  businessId: string | null;
  businessName: string | null;
  signal: AbuseSignal;
}

const DAY = 86_400_000;

export async function loadAbuseAlerts(db: Database): Promise<AbuseAlert[]> {
  const now = Date.now();
  const alerts: AbuseAlert[] = [];

  // Generation spikes: the 24-hour count against the 7-day daily average, per business.
  const gen = await db
    .select({
      businessId: aiGenerations.businessId,
      businessName: businesses.name,
      last24h: sql<number>`count(*) filter (where ${aiGenerations.createdAt} >= ${new Date(now - DAY)})`,
      last7d: count(),
    })
    .from(aiGenerations)
    .innerJoin(businesses, eq(businesses.id, aiGenerations.businessId))
    .where(gte(aiGenerations.createdAt, new Date(now - 7 * DAY)))
    .groupBy(aiGenerations.businessId, businesses.name)
    .orderBy(desc(count()))
    .limit(50);
  for (const g of gen) {
    const signal = generationSpike({
      last24h: Number(g.last24h),
      avgPerDay7d: Number(g.last7d) / 7,
    });
    if (signal) alerts.push({ businessId: g.businessId, businessName: g.businessName, signal });
  }

  // Feedback spam: ten or more private submissions in 24 hours.
  const fb = await db
    .select({ businessId: privateFeedback.businessId, businessName: businesses.name, n: count() })
    .from(privateFeedback)
    .innerJoin(businesses, eq(businesses.id, privateFeedback.businessId))
    .where(gte(privateFeedback.createdAt, new Date(now - DAY)))
    .groupBy(privateFeedback.businessId, businesses.name)
    .having(sql`count(*) >= 10`);
  for (const f of fb) {
    const signal = feedbackSpam({ feedback24h: Number(f.n) });
    if (signal) alerts.push({ businessId: f.businessId, businessName: f.businessName, signal });
  }

  // Repeated sign-ups: three or more successful sign-ups from one hashed address in 24 hours.
  const signups = await db
    .select({ ipHash: userActivityLogs.ipHash, n: count() })
    .from(userActivityLogs)
    .where(
      and(
        eq(userActivityLogs.action, 'auth.signup'),
        eq(userActivityLogs.outcome, 'SUCCESS'),
        gte(userActivityLogs.occurredAt, new Date(now - DAY)),
        sql`${userActivityLogs.ipHash} IS NOT NULL`,
      ),
    )
    .groupBy(userActivityLogs.ipHash)
    .having(sql`count(*) >= 3`);
  for (const s of signups) {
    const signal = repeatedSignups({ signups24h: Number(s.n), ipHash: s.ipHash ?? '' });
    if (signal) alerts.push({ businessId: null, businessName: null, signal });
  }

  // Unsafe Ai context: the owner's own wording asking for what the gate refuses.
  const contexts = await db
    .select({
      businessId: aiBusinessContexts.businessId,
      businessName: businesses.name,
      summary: aiBusinessContexts.summary,
      services: aiBusinessContexts.services,
      contextTerms: aiBusinessContexts.contextTerms,
    })
    .from(aiBusinessContexts)
    .innerJoin(businesses, eq(businesses.id, aiBusinessContexts.businessId))
    .where(eq(businesses.status, 'ACTIVE'))
    .limit(500);
  for (const c of contexts) {
    const signal = unsafeAiContext({
      summary: c.summary,
      services: (c.services as string[] | null) ?? [],
      contextTerms: (c.contextTerms as string[] | null) ?? [],
    });
    if (signal) alerts.push({ businessId: c.businessId, businessName: c.businessName, signal });
  }

  return alerts;
}

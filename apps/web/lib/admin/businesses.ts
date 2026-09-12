import { and, count, desc, eq, gt, ilike, isNull, lt, or, sql } from 'drizzle-orm';
import {
  adminAuditLogs,
  aiGenerations,
  analyticsEvents,
  businesses,
  businessSlugs,
  customDomains,
  payments,
  subscriptions,
  users,
  type Database,
} from '@ai-review/db';
import { isPaidNow } from '@ai-review/core';
import type { AdminBusinessListQuery } from '@ai-review/contracts';

/**
 * Read side of ADMIN-01 and ADMIN-02. Every query here is cross-tenant by design and is
 * reachable only behind `requireAdmin`; nothing in it may be imported by a tenant route.
 */

export const ADMIN_PAGE_SIZE = 25;

export interface AdminBusinessRow {
  id: string;
  name: string;
  slug: string | null;
  category: string;
  city: string | null;
  status: string;
  ownerEmail: string;
  plan: 'FREE' | 'PRO';
  subscriptionStatus: string;
  entitlementSource: string;
  freeUsed: number;
  freeLimit: number;
  proUsed: number;
  proLimit: number;
  expiresAt: Date | null;
  domain: string | null;
  createdAt: Date;
}

export interface AdminBusinessPage {
  rows: AdminBusinessRow[];
  page: number;
  pageSize: number;
  total: number;
}

export async function listBusinesses(
  db: Database,
  query: AdminBusinessListQuery,
): Promise<AdminBusinessPage> {
  const now = new Date();
  const soon = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const paid = and(
    sql`${subscriptions.status} IN ('PRO_ACTIVE', 'PAST_DUE')`,
    gt(subscriptions.expiresAt, now),
  );

  const filters = [isNull(businesses.deletedAt)];
  if (query.q) {
    const needle = `%${query.q.replace(/[%_]/g, '\\$&')}%`;
    filters.push(
      or(
        ilike(businesses.name, needle),
        ilike(users.email, needle),
        ilike(businessSlugs.slug, needle),
      )!,
    );
  }
  if (query.status) filters.push(eq(businesses.status, query.status));
  if (query.plan === 'pro') filters.push(paid!);
  if (query.plan === 'free') filters.push(sql`NOT (${paid})`);
  if (query.expiring) filters.push(and(paid, lt(subscriptions.expiresAt, soon))!);

  const where = and(...filters);
  const base = db
    .select({
      id: businesses.id,
      name: businesses.name,
      slug: businessSlugs.slug,
      category: businesses.category,
      city: businesses.city,
      status: businesses.status,
      ownerEmail: users.email,
      subscriptionStatus: subscriptions.status,
      startsAt: subscriptions.startsAt,
      expiresAt: subscriptions.expiresAt,
      entitlementSource: subscriptions.entitlementSource,
      freeUsed: subscriptions.freeGenerationsUsed,
      freeLimit: subscriptions.freeGenerationLimit,
      proUsed: subscriptions.proGenerationsUsed,
      proLimit: subscriptions.proGenerationLimit,
      domain: customDomains.hostname,
      createdAt: businesses.createdAt,
    })
    .from(businesses)
    .innerJoin(users, eq(users.id, businesses.ownerUserId))
    .innerJoin(subscriptions, eq(subscriptions.businessId, businesses.id))
    .leftJoin(
      businessSlugs,
      and(eq(businessSlugs.businessId, businesses.id), eq(businessSlugs.isPrimary, true)),
    )
    .leftJoin(customDomains, eq(customDomains.businessId, businesses.id))
    .where(where);

  const [totals] = await db
    .select({ total: count() })
    .from(businesses)
    .innerJoin(users, eq(users.id, businesses.ownerUserId))
    .innerJoin(subscriptions, eq(subscriptions.businessId, businesses.id))
    .leftJoin(
      businessSlugs,
      and(eq(businessSlugs.businessId, businesses.id), eq(businessSlugs.isPrimary, true)),
    )
    .where(where);

  const rows = await base
    .orderBy(desc(businesses.createdAt), desc(businesses.id))
    .limit(ADMIN_PAGE_SIZE)
    .offset((query.page - 1) * ADMIN_PAGE_SIZE);

  return {
    rows: rows.map((row) => ({
      ...row,
      plan: isPaidNow(
        { status: row.subscriptionStatus, startsAt: row.startsAt, expiresAt: row.expiresAt },
        now,
      )
        ? 'PRO'
        : 'FREE',
    })),
    page: query.page,
    pageSize: ADMIN_PAGE_SIZE,
    total: Number(totals?.total ?? 0),
  };
}

export interface AdminBusinessDetail extends AdminBusinessRow {
  ownerName: string;
  ownerUserId: string;
  subscriptionId: string;
  startsAt: Date | null;
  entitlementNote: string | null;
  grantedByEmail: string | null;
  amountPaise: number;
  generationsTotal: number;
  generations30d: number;
  scans30d: number;
  payments: Array<{
    id: string;
    status: string;
    amountPaise: number;
    providerPaymentId: string | null;
    paidAt: Date | null;
    createdAt: Date;
  }>;
  audit: Array<{
    id: number;
    action: string;
    reason: string | null;
    actorEmail: string | null;
    before: unknown;
    after: unknown;
    createdAt: Date;
  }>;
}

export async function getBusinessDetail(
  db: Database,
  businessId: string,
): Promise<AdminBusinessDetail | null> {
  const now = new Date();
  const [row] = await db
    .select({
      id: businesses.id,
      name: businesses.name,
      slug: businessSlugs.slug,
      category: businesses.category,
      city: businesses.city,
      status: businesses.status,
      ownerEmail: users.email,
      ownerName: users.fullName,
      ownerUserId: users.id,
      subscriptionId: subscriptions.id,
      subscriptionStatus: subscriptions.status,
      startsAt: subscriptions.startsAt,
      expiresAt: subscriptions.expiresAt,
      entitlementSource: subscriptions.entitlementSource,
      entitlementNote: subscriptions.entitlementNote,
      entitlementGrantedBy: subscriptions.entitlementGrantedBy,
      amountPaise: subscriptions.amountPaise,
      freeUsed: subscriptions.freeGenerationsUsed,
      freeLimit: subscriptions.freeGenerationLimit,
      proUsed: subscriptions.proGenerationsUsed,
      proLimit: subscriptions.proGenerationLimit,
      domain: customDomains.hostname,
      createdAt: businesses.createdAt,
    })
    .from(businesses)
    .innerJoin(users, eq(users.id, businesses.ownerUserId))
    .innerJoin(subscriptions, eq(subscriptions.businessId, businesses.id))
    .leftJoin(
      businessSlugs,
      and(eq(businessSlugs.businessId, businesses.id), eq(businessSlugs.isPrimary, true)),
    )
    .leftJoin(customDomains, eq(customDomains.businessId, businesses.id))
    .where(and(eq(businesses.id, businessId), isNull(businesses.deletedAt)))
    .limit(1);
  if (!row) return null;

  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const [[gens], [gens30], [scans30], paymentRows, auditRows, granter] = await Promise.all([
    db.select({ n: count() }).from(aiGenerations).where(eq(aiGenerations.businessId, businessId)),
    db
      .select({ n: count() })
      .from(aiGenerations)
      .where(
        and(eq(aiGenerations.businessId, businessId), gt(aiGenerations.createdAt, thirtyDaysAgo)),
      ),
    db
      .select({ n: count() })
      .from(analyticsEvents)
      .where(
        and(
          eq(analyticsEvents.businessId, businessId),
          eq(analyticsEvents.eventName, 'qr_scan'),
          gt(analyticsEvents.occurredAt, thirtyDaysAgo),
        ),
      ),
    db
      .select({
        id: payments.id,
        status: payments.status,
        amountPaise: payments.amountPaise,
        providerPaymentId: payments.providerPaymentId,
        paidAt: payments.paidAt,
        createdAt: payments.createdAt,
      })
      .from(payments)
      .where(eq(payments.businessId, businessId))
      .orderBy(desc(payments.createdAt))
      .limit(20),
    db
      .select({
        id: adminAuditLogs.id,
        action: adminAuditLogs.action,
        reason: adminAuditLogs.reason,
        actorEmail: users.email,
        before: adminAuditLogs.beforeState,
        after: adminAuditLogs.afterState,
        createdAt: adminAuditLogs.createdAt,
      })
      .from(adminAuditLogs)
      .leftJoin(users, eq(users.id, adminAuditLogs.actorUserId))
      .where(eq(adminAuditLogs.businessId, businessId))
      .orderBy(desc(adminAuditLogs.id))
      .limit(50),
    row.entitlementGrantedBy
      ? db
          .select({ email: users.email })
          .from(users)
          .where(eq(users.id, row.entitlementGrantedBy))
          .limit(1)
      : Promise.resolve([] as Array<{ email: string }>),
  ]);

  return {
    ...row,
    plan: isPaidNow(
      { status: row.subscriptionStatus, startsAt: row.startsAt, expiresAt: row.expiresAt },
      now,
    )
      ? 'PRO'
      : 'FREE',
    grantedByEmail: granter[0]?.email ?? null,
    generationsTotal: Number(gens?.n ?? 0),
    generations30d: Number(gens30?.n ?? 0),
    scans30d: Number(scans30?.n ?? 0),
    payments: paymentRows,
    audit: auditRows.map((entry) => ({ ...entry, id: Number(entry.id) })),
  };
}

export interface AdminOverview {
  businesses: { total: number; active: number; free: number; pro: number; suspended: number };
  signups: { today: number; last7d: number; last30d: number };
  drafts: { today: number; last30d: number };
  scans: { last30d: number };
  googleOpens: { last30d: number };
  paidValuePaise: number;
  paymentFailures30d: number;
}

export async function loadOverview(db: Database): Promise<AdminOverview> {
  const now = new Date();
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const paid = and(
    sql`${subscriptions.status} IN ('PRO_ACTIVE', 'PAST_DUE')`,
    gt(subscriptions.expiresAt, now),
  );

  const [biz] = await db
    .select({
      total: count(),
      active: count(sql`CASE WHEN ${businesses.status} = 'ACTIVE' THEN 1 END`),
      suspended: count(sql`CASE WHEN ${businesses.status} = 'SUSPENDED' THEN 1 END`),
      pro: count(sql`CASE WHEN ${paid} THEN 1 END`),
      paidValue: sql<number>`COALESCE(SUM(CASE WHEN ${paid} THEN ${subscriptions.amountPaise} END), 0)`,
      today: count(sql`CASE WHEN ${businesses.createdAt} > ${dayAgo} THEN 1 END`),
      week: count(sql`CASE WHEN ${businesses.createdAt} > ${weekAgo} THEN 1 END`),
      month: count(sql`CASE WHEN ${businesses.createdAt} > ${monthAgo} THEN 1 END`),
    })
    .from(businesses)
    .innerJoin(subscriptions, eq(subscriptions.businessId, businesses.id))
    .where(isNull(businesses.deletedAt));

  const [drafts] = await db
    .select({
      today: count(sql`CASE WHEN ${aiGenerations.createdAt} > ${dayAgo} THEN 1 END`),
      month: count(sql`CASE WHEN ${aiGenerations.createdAt} > ${monthAgo} THEN 1 END`),
    })
    .from(aiGenerations);

  const [events] = await db
    .select({
      scans: count(sql`CASE WHEN ${analyticsEvents.eventName} = 'qr_scan' THEN 1 END`),
      opens: count(sql`CASE WHEN ${analyticsEvents.eventName} = 'google_open' THEN 1 END`),
    })
    .from(analyticsEvents)
    .where(gt(analyticsEvents.occurredAt, monthAgo));

  const [failed] = await db
    .select({ n: count() })
    .from(payments)
    .where(and(eq(payments.status, 'FAILED'), gt(payments.createdAt, monthAgo)));

  const total = Number(biz?.total ?? 0);
  const pro = Number(biz?.pro ?? 0);
  return {
    businesses: {
      total,
      active: Number(biz?.active ?? 0),
      suspended: Number(biz?.suspended ?? 0),
      pro,
      free: total - pro,
    },
    signups: {
      today: Number(biz?.today ?? 0),
      last7d: Number(biz?.week ?? 0),
      last30d: Number(biz?.month ?? 0),
    },
    drafts: { today: Number(drafts?.today ?? 0), last30d: Number(drafts?.month ?? 0) },
    scans: { last30d: Number(events?.scans ?? 0) },
    googleOpens: { last30d: Number(events?.opens ?? 0) },
    paidValuePaise: Number(biz?.paidValue ?? 0),
    paymentFailures30d: Number(failed?.n ?? 0),
  };
}

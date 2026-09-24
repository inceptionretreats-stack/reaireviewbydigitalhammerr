import { and, count, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import {
  aiBusinessContexts,
  aiGenerations,
  aiPromptVersions,
  analyticsEvents,
  businessLinks,
  businessSlugs,
  businesses,
  customDomains,
  privateFeedback,
  qrCodes,
  reviewDestinations,
  reviewModes,
  sessions,
  users,
  type Database,
} from '@ai-review/db';

/**
 * One loader per tab of the admin business page (19_Admin_Panel_Spec L56-66). Each reads only
 * what its tab shows, so opening "Owner & account" does not compute a 30-day funnel. All are
 * read-only; every mutation stays behind the audited action routes.
 */

const DAY = 86_400_000;

export interface OwnerAccount {
  userId: string;
  fullName: string;
  email: string;
  mobile: string | null;
  emailVerifiedAt: Date | null;
  lastLoginAt: Date | null;
  failedLoginCount: number;
  lockedUntil: Date | null;
  disabledAt: Date | null;
  createdAt: Date;
  liveSessions: number;
}

export async function loadOwnerAccount(
  db: Database,
  businessId: string,
): Promise<OwnerAccount | null> {
  const [row] = await db
    .select({
      userId: users.id,
      fullName: users.fullName,
      email: users.email,
      mobile: users.mobile,
      emailVerifiedAt: users.emailVerifiedAt,
      lastLoginAt: users.lastLoginAt,
      failedLoginCount: users.failedLoginCount,
      lockedUntil: users.lockedUntil,
      disabledAt: users.disabledAt,
      createdAt: users.createdAt,
    })
    .from(businesses)
    .innerJoin(users, eq(users.id, businesses.ownerUserId))
    .where(eq(businesses.id, businessId))
    .limit(1);
  if (!row) return null;
  const [live] = await db
    .select({ n: count() })
    .from(sessions)
    .where(
      and(
        eq(sessions.userId, row.userId),
        isNull(sessions.revokedAt),
        sql`${sessions.expiresAt} > now()`,
      ),
    );
  return { ...row, liveSessions: Number(live?.n ?? 0) };
}

export interface PublicProfile {
  slugs: Array<{ slug: string; isPrimary: boolean; redirectUntil: Date | null; createdAt: Date }>;
  destination: { url: string; label: string; isEnabled: boolean; updatedAt: Date } | null;
  links: Array<{
    id: string;
    linkType: string;
    label: string | null;
    url: string | null;
    phone: string | null;
    isEnabled: boolean;
    sortOrder: number;
  }>;
  publishedAt: Date | null;
  description: string | null;
  city: string | null;
  state: string | null;
  timezone: string;
}

export async function loadPublicProfile(db: Database, businessId: string): Promise<PublicProfile> {
  const [biz] = await db
    .select({
      publishedAt: businesses.publishedAt,
      description: businesses.description,
      city: businesses.city,
      state: businesses.state,
      timezone: businesses.timezone,
    })
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);
  const [slugs, destinations, links] = await Promise.all([
    db
      .select({
        slug: businessSlugs.slug,
        isPrimary: businessSlugs.isPrimary,
        redirectUntil: businessSlugs.redirectUntil,
        createdAt: businessSlugs.createdAt,
      })
      .from(businessSlugs)
      .where(eq(businessSlugs.businessId, businessId))
      .orderBy(desc(businessSlugs.isPrimary), desc(businessSlugs.createdAt)),
    db
      .select({
        url: reviewDestinations.url,
        label: reviewDestinations.label,
        isEnabled: reviewDestinations.isEnabled,
        updatedAt: reviewDestinations.updatedAt,
      })
      .from(reviewDestinations)
      .where(
        and(eq(reviewDestinations.businessId, businessId), eq(reviewDestinations.isPrimary, true)),
      )
      .limit(1),
    db
      .select({
        id: businessLinks.id,
        linkType: businessLinks.linkType,
        label: businessLinks.label,
        url: businessLinks.url,
        phone: businessLinks.phone,
        isEnabled: businessLinks.isEnabled,
        sortOrder: businessLinks.sortOrder,
      })
      .from(businessLinks)
      .where(eq(businessLinks.businessId, businessId))
      .orderBy(businessLinks.sortOrder),
  ]);
  return {
    slugs,
    destination: destinations[0] ?? null,
    links,
    publishedAt: biz?.publishedAt ?? null,
    description: biz?.description ?? null,
    city: biz?.city ?? null,
    state: biz?.state ?? null,
    timezone: biz?.timezone ?? 'Asia/Kolkata',
  };
}

export interface AiSetup {
  context: {
    summary: string | null;
    services: string[];
    contextTerms: string[];
    draftLanguage: string;
    updatedAt: Date | null;
  } | null;
  modes: Array<{
    id: string;
    name: string;
    description: string | null;
    contextTerms: string[];
    isActive: boolean;
    isArchived: boolean;
    updatedAt: Date;
  }>;
  /** The prompt version the most recent generation used, and the one active now. */
  lastPromptVersion: string | null;
  activePromptVersion: string | null;
}

export async function loadAiSetup(db: Database, businessId: string): Promise<AiSetup> {
  const [[context], modes, [last], [active]] = await Promise.all([
    db
      .select({
        summary: aiBusinessContexts.summary,
        services: aiBusinessContexts.services,
        contextTerms: aiBusinessContexts.contextTerms,
        draftLanguage: aiBusinessContexts.draftLanguage,
        updatedAt: aiBusinessContexts.updatedAt,
      })
      .from(aiBusinessContexts)
      .where(eq(aiBusinessContexts.businessId, businessId))
      .limit(1),
    db
      .select({
        id: reviewModes.id,
        name: reviewModes.name,
        description: reviewModes.description,
        contextTerms: reviewModes.contextTerms,
        isActive: reviewModes.isActive,
        isArchived: reviewModes.isArchived,
        updatedAt: reviewModes.updatedAt,
      })
      .from(reviewModes)
      .where(eq(reviewModes.businessId, businessId))
      .orderBy(desc(reviewModes.isActive), reviewModes.name),
    db
      .select({ version: aiPromptVersions.version })
      .from(aiGenerations)
      .innerJoin(aiPromptVersions, eq(aiPromptVersions.id, aiGenerations.promptVersionId))
      .where(eq(aiGenerations.businessId, businessId))
      .orderBy(desc(aiGenerations.createdAt))
      .limit(1),
    db
      .select({ version: aiPromptVersions.version })
      .from(aiPromptVersions)
      .where(eq(aiPromptVersions.status, 'ACTIVE'))
      .limit(1),
  ]);
  return {
    context: context
      ? {
          summary: context.summary,
          services: (context.services as string[] | null) ?? [],
          contextTerms: (context.contextTerms as string[] | null) ?? [],
          draftLanguage: context.draftLanguage,
          updatedAt: context.updatedAt,
        }
      : null,
    modes: modes.map((m) => ({ ...m, contextTerms: (m.contextTerms as string[] | null) ?? [] })),
    lastPromptVersion: last?.version ?? null,
    activePromptVersion: active?.version ?? null,
  };
}

export interface QrSourceRow {
  id: string;
  code: string;
  sourceLabel: string;
  internalNote: string | null;
  status: string;
  createdAt: Date;
  scans30d: number;
}

export async function loadQrSources(db: Database, businessId: string): Promise<QrSourceRow[]> {
  const since = new Date(Date.now() - 30 * DAY);
  const rows = await db
    .select({
      id: qrCodes.id,
      code: qrCodes.code,
      sourceLabel: qrCodes.sourceLabel,
      internalNote: qrCodes.internalNote,
      status: qrCodes.status,
      createdAt: qrCodes.createdAt,
      scans30d: sql<number>`(
        SELECT count(*) FROM analytics_events e
         WHERE e.qr_code_id = qr_codes.id AND e.event_name = 'qr_scan' AND e.occurred_at >= ${since.toISOString()}::timestamptz
      )`,
    })
    .from(qrCodes)
    .where(eq(qrCodes.businessId, businessId))
    .orderBy(qrCodes.createdAt);
  return rows.map((r) => ({ ...r, scans30d: Number(r.scans30d) }));
}

export interface Funnel30d {
  scans: number;
  pageViews: number;
  drafts: number;
  copies: number;
  googleOpens: number;
  feedbackSubmits: number;
  daily: Array<{ day: string; scans: number; drafts: number; googleOpens: number }>;
}

export async function loadFunnel(db: Database, businessId: string): Promise<Funnel30d> {
  const since = new Date(Date.now() - 30 * DAY);
  const [totals] = await db
    .select({
      scans: sql<number>`count(*) filter (where ${analyticsEvents.eventName} = 'qr_scan')`,
      pageViews: sql<number>`count(*) filter (where ${analyticsEvents.eventName} = 'review_page_view')`,
      drafts: sql<number>`count(*) filter (where ${analyticsEvents.eventName} = 'ai_generate_success')`,
      copies: sql<number>`count(*) filter (where ${analyticsEvents.eventName} = 'review_copy')`,
      googleOpens: sql<number>`count(*) filter (where ${analyticsEvents.eventName} = 'google_open')`,
      feedbackSubmits: sql<number>`count(*) filter (where ${analyticsEvents.eventName} = 'private_feedback_submit')`,
    })
    .from(analyticsEvents)
    .where(and(eq(analyticsEvents.businessId, businessId), gte(analyticsEvents.occurredAt, since)));
  const daily = await db
    .select({
      day: sql<string>`to_char((${analyticsEvents.occurredAt} at time zone 'Asia/Kolkata')::date, 'YYYY-MM-DD')`,
      scans: sql<number>`count(*) filter (where ${analyticsEvents.eventName} = 'qr_scan')`,
      drafts: sql<number>`count(*) filter (where ${analyticsEvents.eventName} = 'ai_generate_success')`,
      googleOpens: sql<number>`count(*) filter (where ${analyticsEvents.eventName} = 'google_open')`,
    })
    .from(analyticsEvents)
    .where(and(eq(analyticsEvents.businessId, businessId), gte(analyticsEvents.occurredAt, since)))
    .groupBy(sql`1`)
    .orderBy(sql`1`);
  return {
    scans: Number(totals?.scans ?? 0),
    pageViews: Number(totals?.pageViews ?? 0),
    drafts: Number(totals?.drafts ?? 0),
    copies: Number(totals?.copies ?? 0),
    googleOpens: Number(totals?.googleOpens ?? 0),
    feedbackSubmits: Number(totals?.feedbackSubmits ?? 0),
    daily: daily.map((d) => ({
      day: d.day,
      scans: Number(d.scans),
      drafts: Number(d.drafts),
      googleOpens: Number(d.googleOpens),
    })),
  };
}

export interface DomainRow {
  id: string;
  hostname: string;
  status: string;
  sslStatus: string | null;
  dnsTarget: string | null;
  activatedAt: Date | null;
  lastCheckedAt: Date | null;
  errorMessage: string | null;
  createdAt: Date;
}

export async function loadDomains(db: Database, businessId: string): Promise<DomainRow[]> {
  return db
    .select({
      id: customDomains.id,
      hostname: customDomains.hostname,
      status: customDomains.status,
      sslStatus: customDomains.sslStatus,
      dnsTarget: customDomains.dnsTarget,
      activatedAt: customDomains.activatedAt,
      lastCheckedAt: customDomains.lastCheckedAt,
      errorMessage: customDomains.errorMessage,
      createdAt: customDomains.createdAt,
    })
    .from(customDomains)
    .where(eq(customDomains.businessId, businessId))
    .orderBy(desc(customDomains.createdAt));
}

export interface UsageView {
  /** Generations per day for the last 14 days, oldest first. */
  daily: Array<{ day: string; generations: number }>;
  last24h: number;
  avgPerDay7d: number;
  feedback24h: number;
  aiSuspendedAt: Date | null;
  aiSuspendedReason: string | null;
  aiThrottleUntil: Date | null;
  aiThrottlePerHour: number | null;
}

export async function loadUsage(db: Database, businessId: string): Promise<UsageView> {
  const now = Date.now();
  const [daily, [day], [week], [feedback], [biz]] = await Promise.all([
    db
      .select({
        day: sql<string>`to_char((${aiGenerations.createdAt} at time zone 'Asia/Kolkata')::date, 'YYYY-MM-DD')`,
        generations: count(),
      })
      .from(aiGenerations)
      .where(
        and(
          eq(aiGenerations.businessId, businessId),
          gte(aiGenerations.createdAt, new Date(now - 14 * DAY)),
        ),
      )
      .groupBy(sql`1`)
      .orderBy(sql`1`),
    db
      .select({ n: count() })
      .from(aiGenerations)
      .where(
        and(
          eq(aiGenerations.businessId, businessId),
          gte(aiGenerations.createdAt, new Date(now - DAY)),
        ),
      ),
    db
      .select({ n: count() })
      .from(aiGenerations)
      .where(
        and(
          eq(aiGenerations.businessId, businessId),
          gte(aiGenerations.createdAt, new Date(now - 7 * DAY)),
        ),
      ),
    db
      .select({ n: count() })
      .from(privateFeedback)
      .where(
        and(
          eq(privateFeedback.businessId, businessId),
          gte(privateFeedback.createdAt, new Date(now - DAY)),
        ),
      ),
    db
      .select({
        aiSuspendedAt: businesses.aiSuspendedAt,
        aiSuspendedReason: businesses.aiSuspendedReason,
        aiThrottleUntil: businesses.aiThrottleUntil,
        aiThrottlePerHour: businesses.aiThrottlePerHour,
      })
      .from(businesses)
      .where(eq(businesses.id, businessId))
      .limit(1),
  ]);
  return {
    daily: daily.map((d) => ({ day: d.day, generations: Number(d.generations) })),
    last24h: Number(day?.n ?? 0),
    avgPerDay7d: Number(week?.n ?? 0) / 7,
    feedback24h: Number(feedback?.n ?? 0),
    aiSuspendedAt: biz?.aiSuspendedAt ?? null,
    aiSuspendedReason: biz?.aiSuspendedReason ?? null,
    aiThrottleUntil: biz?.aiThrottleUntil ?? null,
    aiThrottlePerHour: biz?.aiThrottlePerHour ?? null,
  };
}

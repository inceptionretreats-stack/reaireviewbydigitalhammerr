import { and, asc, count, eq } from 'drizzle-orm';
import {
  analyticsEvents,
  businessSlugs,
  businesses,
  qrCodes,
  subscriptions,
  type Business,
  type Database,
  type Subscription,
} from '@ai-review/db';
import { loadOnboardingProgress } from '@/lib/onboarding-progress';
import { foldQrSources } from './presentation';
import type { OnboardingProgress } from '@/components/onboarding/steps';

/**
 * Everything DASH-01 can honestly show today.
 *
 * Scope note, because the gap is deliberate. `03_Screen_Field_Button_Spec.md` also lists KPI
 * cards, a funnel, top QR sources and top link clicks for this screen. All four read from
 * `analytics_daily_business`, which nothing aggregates into yet, so they are absent rather than
 * mocked: a dashboard that shows invented numbers is worse than one that admits it has none, and
 * a business would make staffing and print decisions on them.
 *
 * The date range in the same list is absent for the same reason — a range control that filters
 * nothing is a lie about what the screen is doing.
 *
 * Every read is keyed on the `businessId` that `TenantGuard` resolved from the session, never on
 * anything from the request. That is AC-003 and RBAC rule 2, and it is why this function takes an
 * id rather than reading one itself.
 *
 * It lives beside the components rather than in `apps/web/lib/` only because of how this build is
 * split across concurrent workstreams; it is plain server-side data access and belongs in `lib/`.
 */

export interface DashboardQrSources {
  active: number;
  disabled: number;
  total: number;
}

export interface DashboardSummary {
  business: {
    name: string;
    status: Business['status'];
    /** AMENDMENT-004: the timezone every date on this screen is formatted in (AC-026). */
    timezone: string;
    publishedAt: Date | null;
  };
  /** The live slug. Null until ONB-01 reserves one, which is why the public URL is optional. */
  slug: string | null;
  /**
   * Null is a broken invariant rather than a normal state — signup creates the row in the same
   * transaction as the business — but the query can genuinely return nothing, so the type says so
   * and the screen reports it instead of crashing on a missing entitlement.
   */
  subscription: {
    status: Subscription['status'];
    amountPaise: number;
    currency: string;
    freeGenerationLimit: number;
    freeGenerationsUsed: number;
    proGenerationLimit: number;
    proGenerationsUsed: number;
    fairUseMonthlySoftLimit: number | null;
    startsAt: Date | null;
    expiresAt: Date | null;
  } | null;
  qrSources: DashboardQrSources;
  progress: OnboardingProgress;
  /**
   * The default source publish creates, so a newly live owner can be shown the code itself rather
   * than told where to find it. Null before publish, and for the theoretical tenant whose sources
   * have all been deleted — which nothing in V1 offers, since QR-01 disables rather than deletes.
   */
  primaryQr: { id: string; code: string } | null;
  /**
   * Whether anyone has ever scanned a code for this business.
   *
   * The signal that the QR has reached the physical world, which is the one thing the dashboard
   * cannot infer from configuration: a business can be perfectly set up and still have its
   * standees in a drawer. It gates the first-steps guidance, so that guidance retires itself the
   * moment it stops being true rather than sitting there forever.
   */
  hasBeenScanned: boolean;
}

export async function loadDashboardSummary(
  db: Database,
  businessId: string,
): Promise<DashboardSummary | null> {
  // Issued together: they are independent reads and the screen cannot render until it has all of
  // them, so serialising would only add latency.
  const [businessRows, slugRows, subscriptionRows, qrRows, progress, primaryQrRows, scanRows] =
    await Promise.all([
      db
        .select({
          name: businesses.name,
          status: businesses.status,
          timezone: businesses.timezone,
          publishedAt: businesses.publishedAt,
        })
        .from(businesses)
        .where(eq(businesses.id, businessId))
        .limit(1),

      // Only the primary slug. Retired aliases still resolve for their 180-day window
      // (AMENDMENT-005, Flow I), but showing one as *the* address would have an owner print it.
      db
        .select({ slug: businessSlugs.slug })
        .from(businessSlugs)
        .where(and(eq(businessSlugs.businessId, businessId), eq(businessSlugs.isPrimary, true)))
        .limit(1),

      db
        .select({
          status: subscriptions.status,
          amountPaise: subscriptions.amountPaise,
          currency: subscriptions.currency,
          freeGenerationLimit: subscriptions.freeGenerationLimit,
          freeGenerationsUsed: subscriptions.freeGenerationsUsed,
          proGenerationLimit: subscriptions.proGenerationLimit,
          proGenerationsUsed: subscriptions.proGenerationsUsed,
          fairUseMonthlySoftLimit: subscriptions.fairUseMonthlySoftLimit,
          startsAt: subscriptions.startsAt,
          expiresAt: subscriptions.expiresAt,
        })
        .from(subscriptions)
        .where(eq(subscriptions.businessId, businessId))
        .limit(1),

      // Grouped in the database rather than counted in TypeScript: a tenant with a hundred standees
      // should not ship a hundred rows to render one number.
      db
        .select({ status: qrCodes.status, rows: count() })
        .from(qrCodes)
        .where(eq(qrCodes.businessId, businessId))
        .groupBy(qrCodes.status),

      loadOnboardingProgress(db, businessId),

      // The default source publish creates is the oldest row (ONB-05-01); id breaks the tie because
      // rows written in one transaction share created_at to the microsecond.
      db
        .select({ id: qrCodes.id, code: qrCodes.code })
        .from(qrCodes)
        .where(eq(qrCodes.businessId, businessId))
        .orderBy(asc(qrCodes.createdAt), asc(qrCodes.id))
        .limit(1),

      // EXISTS, not COUNT: the question is "has this ever happened", and a tenant with a year of
      // scans should not have them tallied to answer it. idx_events_business_name_time covers the
      // lookup, so this stops at the first matching row.
      db
        .select({ id: analyticsEvents.id })
        .from(analyticsEvents)
        .where(
          and(eq(analyticsEvents.businessId, businessId), eq(analyticsEvents.eventName, 'qr_scan')),
        )
        .limit(1),
    ]);

  const business = businessRows[0];
  if (!business) return null;

  return {
    business,
    slug: slugRows[0]?.slug ?? null,
    subscription: subscriptionRows[0] ?? null,
    // Folded in `presentation.ts` rather than here, so the all-disabled and no-rows cases — the two
    // the dashboard's wording turns on — are exercised by a test that needs no database.
    qrSources: foldQrSources(qrRows),
    progress,
    primaryQr: primaryQrRows[0] ?? null,
    hasBeenScanned: scanRows.length > 0,
  };
}

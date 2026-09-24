import { and, eq, isNull } from 'drizzle-orm';
import { businesses, users, type Business, type Database } from '@ai-review/db';
import { countOtherLiveSessions } from '@/lib/account/session-count';

/**
 * Everything SET-01 shows, read once on the server.
 *
 * The screen spec lists five things: account name, email, mobile, password change and business
 * status. Four of them are values; the fifth is a form with nothing to prefill. That is the whole
 * screen, plus the live session count that gives "Log out other sessions" something honest to say.
 *
 * Read server-side rather than fetched on mount, for the reason `onboarding/business/page.tsx`
 * gives: an owner would otherwise watch three populated fields appear out of an empty form and
 * could type into them during the gap. There is no GET /api/v1/account for the same reason — this
 * query is the read path, and adding an endpoint nothing calls would be a second definition of it.
 *
 * Both ids come from the resolved session and never from the request (RBAC rule 2, AC-003), which
 * is why this function takes them rather than resolving anything itself.
 */

export interface AccountSettings {
  account: {
    fullName: string;
    email: string;
    /** E.164 (`normalizePhone`), or '' for a Flow B user created before a number was known. */
    mobile: string;
    hasPassword: boolean;
  };
  business: {
    name: string;
    status: Business['status'];
    publishedAt: Date | null;
    /** AMENDMENT-004. The timezone any date on this screen is formatted in (AC-026). */
    timezone: string;
  };
  /** AMENDMENT-029. The buyer side of the next invoice; '' where nothing has been given. */
  billing: {
    billingLegalName: string;
    gstin: string;
    billingStateCode: string;
    billingAddress: string;
  };
  /** Live sessions other than this one, for SET-01-02's resting state. */
  otherLiveSessions: number;
}

export async function loadAccountSettings(
  database: Database,
  userId: string,
  sessionId: string,
  businessId: string,
): Promise<AccountSettings | null> {
  // One round trip, not three: the three reads are independent and the screen needs all of them
  // before it can render anything.
  const [accountRows, businessRows, otherLiveSessions] = await Promise.all([
    database
      .select({
        fullName: users.fullName,
        email: users.email,
        mobile: users.mobile,
        passwordHash: users.passwordHash,
        // users.email_verified_at is deliberately not read. A change to the address clears it
        // (PATCH /api/v1/account) and the endpoint reports that in its response, so the screen has
        // no use for the resting value — and a 'not confirmed' badge would ask an owner to fix
        // something V1 gives them no way to fix.
      })
      .from(users)
      // deletedAt re-stated even though SessionService.resolve already excludes a deleted user:
      // this module is the read half of a screen that writes, and the two should agree on which
      // rows exist.
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .limit(1),

    database
      .select({
        name: businesses.name,
        status: businesses.status,
        publishedAt: businesses.publishedAt,
        timezone: businesses.timezone,
        billingLegalName: businesses.billingLegalName,
        gstin: businesses.gstin,
        billingStateCode: businesses.billingStateCode,
        billingAddress: businesses.billingAddress,
      })
      .from(businesses)
      .where(eq(businesses.id, businessId))
      .limit(1),

    countOtherLiveSessions(database, userId, sessionId),
  ]);

  const account = accountRows[0];
  const business = businessRows[0];
  // Null rather than a partial screen. Both rows exist for any session that resolved, so this is a
  // broken invariant, and the page says so instead of rendering a form over missing values.
  if (!account || !business) return null;

  return {
    account: {
      fullName: account.fullName,
      email: account.email,
      mobile: account.mobile ?? '',
      hasPassword: account.passwordHash !== null,
    },
    business: {
      name: business.name,
      status: business.status,
      publishedAt: business.publishedAt,
      timezone: business.timezone,
    },
    billing: {
      billingLegalName: business.billingLegalName ?? '',
      gstin: business.gstin ?? '',
      billingStateCode: business.billingStateCode ?? '',
      billingAddress: business.billingAddress ?? '',
    },
    otherLiveSessions,
  };
}

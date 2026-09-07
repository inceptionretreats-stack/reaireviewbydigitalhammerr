import type { LifecycleStatus, PlanStatus } from '@ai-review/ui';
import type { Business, Subscription } from '@ai-review/db';

/**
 * Maps the database's enums onto the words and badge families the dashboard shows.
 *
 * Kept in one module because the mapping is a product statement, not a rendering detail: the
 * schema has four business states and six subscription states, while the design brief's badge
 * families have three and two respectively. Deciding per card which state collapses into which
 * badge is how a tenant ends up described as "Active" on one card and "Pending" on the next.
 *
 * Types are derived from the schema's row types rather than restated, so adding a state to either
 * enum is a compile error here instead of a silently unlabelled badge.
 */

type BusinessStatus = Business['status'];
type SubscriptionStatus = Subscription['status'];

export interface BusinessStatusPresentation {
  /** Badge family from the design brief: Active / Pending / Disabled. */
  badge: LifecycleStatus;
  label: string;
  /** One plain sentence saying what the state means for the owner. */
  note: string;
  /** Whether the public page and QR codes resolve. Only ACTIVE does; see lib/public-business.ts. */
  isPubliclyLive: boolean;
}

const BUSINESS_STATUS: Record<BusinessStatus, BusinessStatusPresentation> = {
  DRAFT: {
    badge: 'PENDING',
    label: 'Draft',
    note: 'Your page is not public yet. Finish setup and publish to make it live.',
    isPubliclyLive: false,
  },
  ACTIVE: {
    badge: 'ACTIVE',
    label: 'Live',
    note: 'Your public page and every QR code are working.',
    isPubliclyLive: true,
  },
  // Flow J: an admin suspension shows the public page as unavailable and stops AI generation.
  // Saying so here is the difference between an owner opening a support ticket and one staring
  // at a page that has silently stopped working.
  SUSPENDED: {
    badge: 'DISABLED',
    label: 'Suspended',
    note: 'Your public page is unavailable and AI generation is paused. Contact support.',
    isPubliclyLive: false,
  },
  CLOSED: {
    badge: 'DISABLED',
    label: 'Closed',
    note: 'This business is closed. Contact support if that is not what you expected.',
    isPubliclyLive: false,
  },
};

export function describeBusinessStatus(status: BusinessStatus): BusinessStatusPresentation {
  return BUSINESS_STATUS[status];
}

export interface PlanPresentation {
  /** Badge family from the design brief: Free / Pro. */
  badge: PlanStatus;
  label: string;
  note: string;
  /**
   * Whether the ten free generations are still the governing limit (D-004, AC-013).
   *
   * `subscriptions.free_generations_used` keeps counting up as a historical figure, so on a paid
   * plan showing it as a limit would report a ceiling the tenant no longer has.
   */
  freeQuotaGoverns: boolean;
}

const PLAN: Record<SubscriptionStatus, PlanPresentation> = {
  FREE: {
    badge: 'FREE',
    label: 'Free',
    note: 'Ten AI generations are included. Upgrade for unlimited use within fair use.',
    freeQuotaGoverns: true,
  },
  CHECKOUT_PENDING: {
    badge: 'FREE',
    label: 'Payment in progress',
    note: 'We are waiting for your payment to be confirmed. The free allowance still applies.',
    freeQuotaGoverns: true,
  },
  PRO_ACTIVE: {
    badge: 'PRO',
    label: 'Pro',
    note: 'All V1 features are included (D-005).',
    freeQuotaGoverns: false,
  },
  // PAST_DUE keeps the entitlement while a renewal is chased, so the free counter is not the
  // limit yet. That is a commercial choice, not something Flow J spells out.
  PAST_DUE: {
    badge: 'PRO',
    label: 'Pro — payment overdue',
    note: 'Your renewal has not gone through. Renew to avoid losing Pro features.',
    freeQuotaGoverns: false,
  },
  // Flow J: an expired plan keeps the account and profile, and falls back to whatever remains of
  // the free allowance — which for a tenant that upgraded early may be all ten.
  EXPIRED: {
    badge: 'FREE',
    label: 'Expired',
    note: 'Your Pro year has ended. Any unused free allowance still applies.',
    freeQuotaGoverns: true,
  },
  CANCELLED: {
    badge: 'FREE',
    label: 'Cancelled',
    note: 'Your subscription was cancelled. Any unused free allowance still applies.',
    freeQuotaGoverns: true,
  },
};

export function describePlan(status: SubscriptionStatus): PlanPresentation {
  return PLAN[status];
}

/**
 * Money for display, from the paise the schema stores.
 *
 * Fraction digits are 0 to 2 rather than a fixed 2: the only V1 price is a round ₹999 (D-005) and
 * "₹999.00" reads like a rounding error, but truncating outright would misreport a future price
 * that does carry paise.
 */
export function formatMoney(amountPaise: number, currency: string): string {
  const major = amountPaise / 100;
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(major);
  } catch {
    // `currency` is a plain char(3) column, so an invalid code is reachable. Showing the number
    // with a bare code is far better than a 500 on the dashboard over a formatting detail.
    return `${currency} ${major.toFixed(2)}`;
  }
}

/**
 * A date in the business's own timezone (AMENDMENT-004, AC-026).
 *
 * Formatting on the server keeps it deterministic — no hydration mismatch, and no dependence on
 * whichever timezone the owner's laptop happens to be in when they check a renewal date.
 */
export function formatDate(value: Date | null, timezone: string): string | null {
  if (!value) return null;
  try {
    return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeZone: timezone }).format(
      value,
    );
  } catch {
    // businesses.timezone is a free-text column; an unrecognised IANA name must not take the
    // dashboard down. UTC is the documented default AC-026 allows for.
    return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeZone: 'UTC' }).format(value);
  }
}

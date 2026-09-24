import type { LifecycleStatus, PlanStatus } from '@ai-review/ui';
import type { Business, QrCode, Subscription } from '@ai-review/db';
import type { DashboardQrSources } from './summary';

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
 *
 * Every export is a pure function over erasable types, so all of it is testable without a database
 * or a React renderer — which is the reason the QR-source fold and its sentence live here too
 * rather than inside the query and the component that use them.
 */

type BusinessStatus = Business['status'];
type SubscriptionStatus = Subscription['status'];
type QrStatus = QrCode['status'];

export interface BusinessStatusPresentation {
  /** Badge family from the design brief: Active / Pending / Disabled. */
  badge: LifecycleStatus;
  label: string;
  /** One plain sentence saying what the state means for the owner. */
  note: string;
  /** Whether the public page and QR codes resolve. Only ACTIVE does; see lib/customer/public-business.ts. */
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
    note: 'Your public page is unavailable and Ai generation is paused. Contact support.',
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
  /** Selects the independent lifetime Free or annual Pro counter shown to the owner. */
  quotaKind: 'FREE' | 'PRO';
}

const PLAN: Record<SubscriptionStatus, PlanPresentation> = {
  FREE: {
    badge: 'FREE',
    label: 'Free',
    note: 'Ten Ai review drafts are included. Pro adds 2,000 drafts per subscription year.',
    quotaKind: 'FREE',
  },
  CHECKOUT_PENDING: {
    badge: 'FREE',
    label: 'Payment in progress',
    note: 'We are waiting for your payment to be confirmed. The free allowance still applies.',
    quotaKind: 'FREE',
  },
  PRO_ACTIVE: {
    badge: 'PRO',
    label: 'Pro',
    note: 'Your plan includes up to 2,000 Ai review drafts in each subscription year.',
    quotaKind: 'PRO',
  },
  // PAST_DUE keeps the entitlement while a renewal is chased, so the free counter is not the
  // limit yet. That is a commercial choice, not something Flow J spells out.
  PAST_DUE: {
    badge: 'PRO',
    label: 'Pro — payment overdue',
    note: 'Your renewal has not gone through. Renew to avoid losing Pro features.',
    quotaKind: 'PRO',
  },
  // Flow J: an expired plan keeps the account and profile, and falls back to whatever remains of
  // the free allowance — which for a tenant that upgraded early may be all ten.
  EXPIRED: {
    badge: 'FREE',
    label: 'Expired',
    note: 'Your Pro year has ended. Any unused free allowance still applies.',
    quotaKind: 'FREE',
  },
  CANCELLED: {
    badge: 'FREE',
    label: 'Cancelled',
    note: 'Your subscription was cancelled. Any unused free allowance still applies.',
    quotaKind: 'FREE',
  },
};

export function describePlan(status: SubscriptionStatus): PlanPresentation {
  return PLAN[status];
}

/**
 * Folds the grouped `qr_status` rows the dashboard query returns into the three numbers it shows.
 *
 * Drizzle returns one row per status *that exists*, so a tenant with nothing disabled has no
 * DISABLED row at all and a tenant with no sources returns no rows — which is why the counters
 * start at zero rather than being read out of the array.
 */
export function foldQrSources(
  rows: readonly { status: QrStatus; rows: number }[],
): DashboardQrSources {
  const counts: DashboardQrSources = { active: 0, disabled: 0, total: 0 };
  for (const row of rows) {
    if (row.status === 'ACTIVE') counts.active += row.rows;
    else counts.disabled += row.rows;
    counts.total += row.rows;
  }
  return counts;
}

/**
 * What the enabled-source count means right now — which depends on the tenant as much as on the
 * sources.
 *
 * "Enabled" is a property of the row; "working" is a property of the tenant.
 * `lib/customer/public-business.ts` resolves a QR only for an ACTIVE business, so on a DRAFT, SUSPENDED or
 * CLOSED tenant nothing scans whatever these counts say, and a card that claimed otherwise would
 * keep a standee on a counter that answers "unavailable" (Flow J).
 */
export function describeQrSources(
  qrSources: DashboardQrSources,
  businessStatus: BusinessStatus,
): string {
  if (businessStatus === 'DRAFT') {
    // D-026: every QR is dynamic and publishing creates the first one (ONB-05-01). Saying so turns
    // a zero from something that looks broken into the next thing to do.
    return qrSources.total === 0
      ? 'Your first QR code is created when you publish.'
      : 'Your sources start scanning once you publish.';
  }

  // SUSPENDED and CLOSED both resolve as unavailable. The number stays visible because it is the
  // configuration the owner will come back to; the status badge and PublicPageCard carry what to do
  // about it, so this sentence only has to stop being false.
  if (businessStatus !== 'ACTIVE') {
    return 'No source is scanning while your public page is unavailable.';
  }

  // Reachable only after publish if every source was later removed; publish itself creates one.
  if (qrSources.total === 0) return 'You have no QR sources.';

  // "more" presumes some are active, so it cannot be used when none is — "2 more are disabled."
  // above a value of 0 tells an owner that two of some larger number are off.
  if (qrSources.active === 0) {
    return qrSources.disabled === 1
      ? 'Your only source is disabled, so nothing scans.'
      : `All ${qrSources.disabled} of your sources are disabled, so nothing scans.`;
  }

  if (qrSources.disabled === 1) return '1 more is disabled.';
  if (qrSources.disabled > 1) return `${qrSources.disabled} more are disabled.`;
  return 'Every source you have created is working.';
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

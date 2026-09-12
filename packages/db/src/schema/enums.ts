import { customType, pgEnum } from 'drizzle-orm/pg-core';

/**
 * `citext` — case-insensitive text, used for emails and slugs.
 * Requires `CREATE EXTENSION citext`, issued in migration 0000.
 */
export const citext = customType<{ data: string }>({
  dataType() {
    return 'citext';
  },
});

export const userRole = pgEnum('user_role', [
  'BUSINESS_OWNER',
  'BUSINESS_SUPPORT_VIEWER',
  'SUPER_ADMIN',
]);

export const businessStatus = pgEnum('business_status', ['DRAFT', 'ACTIVE', 'SUSPENDED', 'CLOSED']);

export const subscriptionStatus = pgEnum('subscription_status', [
  'FREE',
  'CHECKOUT_PENDING',
  'PRO_ACTIVE',
  'PAST_DUE',
  'EXPIRED',
  'CANCELLED',
]);

export const feedbackStatus = pgEnum('feedback_status', ['NEW', 'READ', 'ARCHIVED']);

export const customerRequestStatus = pgEnum('customer_request_status', [
  'NOT_CONTACTED',
  'MESSAGE_PREPARED',
  'MESSAGE_SENT_MANUAL',
  'LINK_CLICKED',
  'AI_GENERATED',
  'REVIEW_COPIED',
  'GOOGLE_OPENED',
  'PRIVATE_FEEDBACK',
]);

export const qrStatus = pgEnum('qr_status', ['ACTIVE', 'DISABLED']);

export const domainStatus = pgEnum('domain_status', [
  'PENDING_DNS',
  'PENDING_SSL',
  'ACTIVE',
  'ERROR',
  'REMOVED',
]);

export const aiPromptStatus = pgEnum('ai_prompt_status', ['DRAFT', 'ACTIVE', 'ARCHIVED']);

/**
 * The language a business's AI review drafts are written in (CHANGE-003).
 *
 * `hinglish` is everyday spoken Hindi in Roman script, mixed with English the way people in
 * India write Google reviews. The default is Hinglish, not English: the product's market is
 * Indian local businesses, and D-011's "English only in V1" was superseded on 11 September 2026.
 * The same two literals are declared in @ai-review/contracts and @ai-review/core, because
 * neither may import this package's runtime — a test pins that the three lists agree.
 */
export const draftLanguage = pgEnum('draft_language', ['en', 'hinglish']);

/**
 * Public profile section types (D-014, D-015).
 *
 * AMENDMENT — 06_Database_Schema.sql typed this as a free `varchar(40)`. It is an enum
 * here so that the set of renderable section types is closed, which 19_Admin_Panel_Spec
 * ("Allowed profile section types") assumes is enforceable.
 *
 * GOOGLE_REVIEW appears here as a *presentation* row only: it controls whether and where
 * the Review Us button renders. The destination URL itself lives in `review_destinations`,
 * which is the single source of truth (see AMENDMENT-003). A GOOGLE_REVIEW link row must
 * therefore carry no url of its own.
 */
export const linkType = pgEnum('link_type', [
  'GOOGLE_REVIEW',
  'WHATSAPP',
  'CALL',
  'INSTAGRAM',
  'FACEBOOK',
  'WEBSITE',
  'DIRECTIONS',
  'CUSTOM',
]);

/**
 * AMENDMENT — 06_Database_Schema.sql left `payments.status` a bare `varchar(40)` while every
 * comparable field is an enum. Values follow Razorpay's payment lifecycle.
 */
/**
 * How a Pro entitlement came to be. 19_Admin_Panel_Spec: "Manual entitlement change must be
 * visually distinct from paid entitlement" — which is only possible if the row remembers.
 */
export const entitlementSource = pgEnum('entitlement_source', ['NONE', 'PAYMENT', 'ADMIN']);

export const paymentStatus = pgEnum('payment_status', [
  'CREATED',
  'AUTHORIZED',
  'CAPTURED',
  'REFUNDED',
  'FAILED',
]);

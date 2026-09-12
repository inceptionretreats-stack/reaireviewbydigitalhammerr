import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { entitlementSource, paymentStatus, subscriptionStatus } from './enums';
import { businesses } from './business';
import { users } from './identity';

/**
 * Entitlement. Exactly two states matter commercially: Free and Pro (ADR-011, D-004, D-005).
 *
 * Free and Pro use separate counters because the Free allowance is lifetime while Pro renews
 * annually. Keeping both on the subscription row lets each reservation use one atomic
 * conditional UPDATE (see packages/core), never read-modify-write.
 */
export const subscriptions = pgTable(
  'subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .unique()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    status: subscriptionStatus('status').notNull().default('FREE'),
    planCode: varchar('plan_code', { length: 40 }).notNull().default('AI_REVIEW_PRO_ANNUAL'),
    currency: char('currency', { length: 3 }).notNull().default('INR'),
    amountPaise: integer('amount_paise').notNull().default(99900),
    freeGenerationLimit: integer('free_generation_limit').notNull().default(10),
    freeGenerationsUsed: integer('free_generations_used').notNull().default(0),
    proGenerationLimit: integer('pro_generation_limit').notNull().default(2000),
    // Migration 0003 resets this when startsAt advances to a new paid period. Keeping the reset at
    // the database boundary prevents a future webhook or admin path from carrying usage forward.
    proGenerationsUsed: integer('pro_generations_used').notNull().default(0),
    fairUseMonthlySoftLimit: integer('fair_use_monthly_soft_limit'),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    razorpayPlanId: varchar('razorpay_plan_id', { length: 100 }),
    razorpaySubscriptionId: varchar('razorpay_subscription_id', { length: 100 }),
    autoRenew: boolean('auto_renew').notNull().default(false),
    /** Who or what put this row on Pro. ADMIN grants carry the granting admin and their note. */
    entitlementSource: entitlementSource('entitlement_source').notNull().default('NONE'),
    // set null, not restrict: the audit log is the permanent record of who granted what, and
    // an admin account leaving must not pin every row it ever touched.
    entitlementGrantedBy: uuid('entitlement_granted_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    entitlementNote: varchar('entitlement_note', { length: 500 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [
    check('ck_free_used_non_negative', sql`free_generations_used >= 0`),
    check('ck_free_used_within_limit', sql`free_generations_used <= free_generation_limit`),
    check('ck_pro_limit_positive', sql`pro_generation_limit > 0`),
    check('ck_pro_used_non_negative', sql`pro_generations_used >= 0`),
    // The quota consumer relies on these bounds: neither plan can over-consume its allowance.
    check('ck_pro_used_within_limit', sql`pro_generations_used <= pro_generation_limit`),
    check(
      'ck_subscription_period_pair',
      sql`(starts_at IS NULL AND expires_at IS NULL) OR (starts_at IS NOT NULL AND expires_at IS NOT NULL)`,
    ),
    check(
      'ck_subscription_period_order',
      sql`starts_at IS NULL OR expires_at IS NULL OR starts_at < expires_at`,
    ),
    check(
      'ck_paid_status_has_period',
      sql`status NOT IN ('PRO_ACTIVE', 'PAST_DUE') OR (starts_at IS NOT NULL AND expires_at IS NOT NULL)`,
    ),
  ],
);

export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'restrict' }),
    subscriptionId: uuid('subscription_id').references(() => subscriptions.id, {
      onDelete: 'set null',
    }),
    provider: varchar('provider', { length: 40 }).notNull().default('RAZORPAY'),
    providerPaymentId: varchar('provider_payment_id', { length: 120 }),
    providerOrderId: varchar('provider_order_id', { length: 120 }),
    providerSubscriptionId: varchar('provider_subscription_id', { length: 120 }),
    amountPaise: integer('amount_paise').notNull(),
    currency: char('currency', { length: 3 }).notNull().default('INR'),
    // AMENDMENT-006 — was an unconstrained varchar(40).
    status: paymentStatus('status').notNull(),
    rawReference: jsonb('raw_reference').notNull().default({}),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_payments_business').on(t.businessId, t.createdAt.desc())],
);

/**
 * Webhook idempotency ledger (AC-015).
 *
 * providerEventId is unique, so a redelivered Razorpay event collides on insert instead of
 * activating an entitlement twice.
 */
export const paymentWebhookEvents = pgTable('payment_webhook_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  provider: varchar('provider', { length: 40 }).notNull(),
  providerEventId: varchar('provider_event_id', { length: 160 }).unique(),
  eventType: varchar('event_type', { length: 120 }).notNull(),
  payloadHash: char('payload_hash', { length: 64 }).notNull(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
  processingError: text('processing_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Subscription = typeof subscriptions.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type PaymentWebhookEvent = typeof paymentWebhookEvents.$inferSelect;

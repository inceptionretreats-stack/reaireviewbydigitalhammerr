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
  uniqueIndex,
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
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),

    // AMENDMENT-029 — refunds accumulate here; the row is REFUNDED only when the whole amount
    // has gone back. A partial refund is goodwill and leaves the entitlement alone.
    refundedPaise: integer('refunded_paise').notNull().default(0),
    refundedAt: timestamp('refunded_at', { withTimezone: true }),
    failureReason: varchar('failure_reason', { length: 500 }),

    // AMENDMENT-029 — the invoice, frozen at settlement. The seller and buyer blocks and the
    // tax split are snapshots so a later change of price, GSTIN or address never rewrites a
    // document that has been issued (ADMIN-04-02).
    invoiceNumber: varchar('invoice_number', { length: 40 }).unique(),
    invoiceIssuedAt: timestamp('invoice_issued_at', { withTimezone: true }),
    taxBreakdown: jsonb('tax_breakdown'),
    sellerSnapshot: jsonb('seller_snapshot'),
    buyerSnapshot: jsonb('buyer_snapshot'),
    receiptEmailedAt: timestamp('receipt_emailed_at', { withTimezone: true }),
  },
  (t) => [
    index('idx_payments_business').on(t.businessId, t.createdAt.desc()),
    index('idx_payments_status_time').on(t.status, t.createdAt.desc()),
    index('idx_payments_provider_payment').on(t.providerPaymentId),
    check('ck_refund_within_amount', sql`refunded_paise >= 0 AND refunded_paise <= amount_paise`),
  ],
);

/**
 * AMENDMENT-029 — one row per refund attempt, whether an admin started it here or someone
 * pressed Refund in the Razorpay dashboard (then requested_by is null and the webhook creates
 * the row). provider_refund_id is unique so a redelivered refund event is a no-op.
 */
export const paymentRefunds = pgTable(
  'payment_refunds',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    paymentId: uuid('payment_id')
      .notNull()
      .references(() => payments.id, { onDelete: 'restrict' }),
    providerRefundId: varchar('provider_refund_id', { length: 120 }).unique(),
    amountPaise: integer('amount_paise').notNull(),
    status: varchar('status', { length: 16 }).notNull().default('REQUESTED'),
    reason: varchar('reason', { length: 1000 }),
    requestedBy: uuid('requested_by').references(() => users.id, { onDelete: 'set null' }),
    error: varchar('error', { length: 500 }),
    rawReference: jsonb('raw_reference').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (t) => [
    index('idx_payment_refunds_payment').on(t.paymentId, t.createdAt.desc()),
    check('ck_refund_amount_positive', sql`amount_paise > 0`),
    check('ck_refund_status', sql`status IN ('REQUESTED', 'PENDING', 'PROCESSED', 'FAILED')`),
  ],
);

/**
 * AMENDMENT-029 — invoice numbering. One row per series (a financial year), advanced with a
 * single UPSERT inside the settlement transaction, so numbers are consecutive and a rolled-back
 * settlement leaves no gap.
 */
export const invoiceSequences = pgTable('invoice_sequences', {
  series: varchar('series', { length: 20 }).primaryKey(),
  nextValue: integer('next_value').notNull().default(1),
});

/**
 * AMENDMENT-029 — renewal reminders and the expiry notice, one row per (period, kind), so a
 * cron that runs twice, or late, never sends the same email twice.
 */
export const subscriptionReminders = pgTable(
  'subscription_reminders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    subscriptionId: uuid('subscription_id')
      .notNull()
      .references(() => subscriptions.id, { onDelete: 'cascade' }),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    kind: varchar('kind', { length: 12 }).notNull(),
    periodExpiresAt: timestamp('period_expires_at', { withTimezone: true }).notNull(),
    attempts: integer('attempts').notNull().default(0),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    skippedAt: timestamp('skipped_at', { withTimezone: true }),
    lastError: varchar('last_error', { length: 500 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_reminder_once').on(t.subscriptionId, t.periodExpiresAt, t.kind),
    index('idx_reminders_pending')
      .on(t.sentAt)
      .where(sql`sent_at IS NULL AND skipped_at IS NULL`),
    check('ck_reminder_kind', sql`kind IN ('T30', 'T7', 'T1', 'EXPIRED')`),
  ],
);

/**
 * Webhook idempotency ledger (AC-015).
 *
 * providerEventId is unique, so a redelivered Razorpay event collides on insert instead of
 * activating an entitlement twice.
 */
export const paymentWebhookEvents = pgTable(
  'payment_webhook_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: varchar('provider', { length: 40 }).notNull(),
    providerEventId: varchar('provider_event_id', { length: 160 }).unique(),
    eventType: varchar('event_type', { length: 120 }).notNull(),
    payloadHash: char('payload_hash', { length: 64 }).notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    processingError: text('processing_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // AMENDMENT-029 — which payment the event landed on and how it ended, so the admin ledger
    // can show delivery per payment without re-parsing payloads.
    paymentId: uuid('payment_id').references(() => payments.id, { onDelete: 'set null' }),
    outcome: varchar('outcome', { length: 16 }),
  },
  (t) => [index('idx_webhook_events_time').on(t.createdAt.desc())],
);

export type Subscription = typeof subscriptions.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type PaymentWebhookEvent = typeof paymentWebhookEvents.$inferSelect;
export type PaymentRefund = typeof paymentRefunds.$inferSelect;
export type InvoiceSequence = typeof invoiceSequences.$inferSelect;
export type SubscriptionReminder = typeof subscriptionReminders.$inferSelect;

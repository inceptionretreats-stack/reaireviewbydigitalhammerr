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
import { paymentStatus, subscriptionStatus } from './enums';
import { businesses } from './business';

/**
 * Entitlement. Exactly two states matter commercially: Free and Pro (ADR-011, D-004, D-005).
 *
 * freeGenerationsUsed is the counter AC-013 turns on — a free business gets exactly 10
 * successful public generations, and a concurrent 11th must not slip through. It is consumed
 * by a single atomic conditional UPDATE (see packages/core), never read-modify-write.
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
    fairUseMonthlySoftLimit: integer('fair_use_monthly_soft_limit'),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    razorpayPlanId: varchar('razorpay_plan_id', { length: 100 }),
    razorpaySubscriptionId: varchar('razorpay_subscription_id', { length: 100 }),
    autoRenew: boolean('auto_renew').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [
    check('ck_free_used_non_negative', sql`free_generations_used >= 0`),
    // The quota consumer relies on this: it can never over-consume past the limit.
    check('ck_free_used_within_limit', sql`free_generations_used <= free_generation_limit`),
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

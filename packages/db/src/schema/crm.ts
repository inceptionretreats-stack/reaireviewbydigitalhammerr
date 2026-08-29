import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  date,
  index,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { citext, customerRequestStatus, feedbackStatus } from './enums';
import { businesses } from './business';
import { anonymousSessions } from './qr';

/**
 * Private feedback — offered to every visitor regardless of sentiment (D-010, FB-01-01).
 *
 * This is deliberately NOT a rating gate: there is no star input anywhere in the customer
 * flow (D-009), so there is nothing to route on. See 13_Security_Privacy_Compliance.md rule 3.
 */
export const privateFeedback = pgTable(
  'private_feedback',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    anonymousSessionId: uuid('anonymous_session_id').references(() => anonymousSessions.id, {
      onDelete: 'set null',
    }),
    name: varchar('name', { length: 120 }),
    mobile: varchar('mobile', { length: 20 }),
    message: varchar('message', { length: 2000 }).notNull(),
    status: feedbackStatus('status').notNull().default('NEW'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_feedback_business_status').on(t.businessId, t.status, t.createdAt.desc())],
);

/** Contact list for preparing manual review requests only — not a sales CRM (D-018, CRM-01-01). */
export const customers = pgTable(
  'customers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 120 }).notNull(),
    mobile: varchar('mobile', { length: 20 }).notNull(),
    email: citext('email'),
    visitDate: date('visit_date'),
    note: varchar('note', { length: 1000 }),
    status: customerRequestStatus('status').notNull().default('NOT_CONTACTED'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('idx_customers_business_mobile')
      .on(t.businessId, t.mobile)
      .where(sql`deleted_at IS NULL`),
  ],
);

export const reviewRequestTemplates = pgTable(
  'review_request_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 100 }).notNull(),
    templateText: varchar('template_text', { length: 1200 }).notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_default_request_template')
      .on(t.businessId)
      .where(sql`is_default`),
  ],
);

/**
 * A prepared manual request. The platform never sends anything (D-017, ADR-004, REQ-01-02):
 * the owner copies the message or opens a wa.me deep link and sends from their own number.
 *
 * trackingTokenHash lets a later click be attributed back to this request without exposing
 * the customer's identity in public analytics (Flow F step 9).
 */
export const reviewRequests = pgTable(
  'review_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    templateId: uuid('template_id').references(() => reviewRequestTemplates.id, {
      onDelete: 'set null',
    }),
    trackingTokenHash: char('tracking_token_hash', { length: 64 }).notNull().unique(),
    renderedMessage: varchar('rendered_message', { length: 1500 }).notNull(),
    preparedAt: timestamp('prepared_at', { withTimezone: true }).notNull().defaultNow(),
    markedSentAt: timestamp('marked_sent_at', { withTimezone: true }),
    firstClickedAt: timestamp('first_clicked_at', { withTimezone: true }),
    lastClickedAt: timestamp('last_clicked_at', { withTimezone: true }),
  },
  (t) => [index('idx_review_requests_customer').on(t.customerId, t.preparedAt.desc())],
);

export type PrivateFeedback = typeof privateFeedback.$inferSelect;
export type Customer = typeof customers.$inferSelect;
export type ReviewRequestTemplate = typeof reviewRequestTemplates.$inferSelect;
export type ReviewRequest = typeof reviewRequests.$inferSelect;

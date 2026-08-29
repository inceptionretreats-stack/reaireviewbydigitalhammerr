import {
  bigint,
  date,
  index,
  jsonb,
  pgTable,
  primaryKey,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { businesses } from './business';
import { customers } from './crm';
import { anonymousSessions, qrCodes } from './qr';

/**
 * Append-only event stream (ADR-005).
 *
 * AMENDMENT-012 — declared PARTITION BY RANGE (occurred_at), monthly. At the modelled scale
 * this table reaches roughly 300M rows and 100-150 GB, and 13_Security_Privacy_Compliance.md
 * sets 13-month retention on it. Enforcing that retention by DELETE against a table that size
 * is a maintenance incident; dropping a partition is instant. Partitioning is free at CREATE
 * TABLE and expensive to retrofit, so it is declared now.
 *
 * Two consequences of partitioning, both reflected below: Postgres requires the partition key
 * to participate in every unique constraint, so the primary key is (id, occurred_at) rather
 * than id alone, and the event_id uniqueness that guards ingestion replay becomes
 * (event_id, occurred_at).
 *
 * The partitioned DDL itself lives in the hand-written migration, since Drizzle's DSL cannot
 * express PARTITION BY. This declaration exists so queries stay typed.
 *
 * Semantics that must not drift (AC-025, D-028): google_open records that Google was opened.
 * It is never evidence of submission, and no metric derived from it may say otherwise.
 */
export const analyticsEvents = pgTable(
  'analytics_events',
  {
    // GENERATED ALWAYS AS IDENTITY in the migration. Declared here too so the type omits it
    // from inserts — without this the model and the real table disagree.
    id: bigint('id', { mode: 'number' }).notNull().generatedAlwaysAsIdentity(),
    eventId: uuid('event_id').notNull().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    anonymousSessionId: uuid('anonymous_session_id').references(() => anonymousSessions.id, {
      onDelete: 'set null',
    }),
    qrCodeId: uuid('qr_code_id').references(() => qrCodes.id, { onDelete: 'set null' }),
    customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
    eventName: varchar('event_name', { length: 80 }).notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    properties: jsonb('properties').notNull().default({}),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.occurredAt] }),
    uniqueIndex('uq_analytics_event_id').on(t.eventId, t.occurredAt),
    index('idx_events_business_time').on(t.businessId, t.occurredAt.desc()),
    index('idx_events_business_name_time').on(t.businessId, t.eventName, t.occurredAt.desc()),
  ],
);

/**
 * Precomputed daily rollups for dashboards (ADR-005, 02_System_Architecture.md).
 *
 * metricDate is resolved in the owning business's timezone (businesses.timezone,
 * AMENDMENT-004) so AC-026 has a defined day boundary rather than an implicit UTC one.
 */
export const analyticsDailyBusiness = pgTable(
  'analytics_daily_business',
  {
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    metricDate: date('metric_date').notNull(),
    metricName: varchar('metric_name', { length: 80 }).notNull(),
    dimensionKey: varchar('dimension_key', { length: 120 }).notNull().default(''),
    metricValue: bigint('metric_value', { mode: 'number' }).notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.businessId, t.metricDate, t.metricName, t.dimensionKey] }),
    index('idx_daily_business_date').on(t.businessId, t.metricDate.desc()),
  ],
);

export type AnalyticsEvent = typeof analyticsEvents.$inferSelect;
export type AnalyticsDailyBusiness = typeof analyticsDailyBusiness.$inferSelect;

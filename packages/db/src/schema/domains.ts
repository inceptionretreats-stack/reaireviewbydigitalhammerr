import { sql } from 'drizzle-orm';
import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { citext, domainStatus } from './enums';
import { businesses } from './business';

/**
 * Customer-owned hostnames, fronted by a provider adapter (ADR-009, D-024).
 *
 * AMENDMENT-011 — the original schema put a plain global UNIQUE on hostname. Combined with a
 * REMOVED status that keeps the row, that permanently burns the hostname: once a business
 * removes review.example.com, no tenant can ever claim it again, including the original owner
 * re-adding it. The uniqueness that AC-027 actually asks for is "not claimable by a second
 * tenant *while live*", so it is a partial index over live statuses instead.
 */
export const customDomains = pgTable(
  'custom_domains',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    hostname: citext('hostname').notNull(),
    status: domainStatus('status').notNull().default('PENDING_DNS'),
    provider: varchar('provider', { length: 40 }).notNull().default('CLOUDFLARE'),
    providerHostnameId: varchar('provider_hostname_id', { length: 160 }),
    dnsTarget: text('dns_target'),
    verificationRecords: jsonb('verification_records').notNull().default([]),
    sslStatus: varchar('ssl_status', { length: 60 }),
    activatedAt: timestamp('activated_at', { withTimezone: true }),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
    errorMessage: varchar('error_message', { length: 500 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // AC-027: an unverified hostname cannot be claimed by a second tenant. REMOVED rows are
    // excluded so a released hostname becomes available again.
    uniqueIndex('uq_live_hostname')
      .on(t.hostname)
      .where(sql`status <> 'REMOVED'`),
    // DOM-01-01: one active custom hostname per business in V1.
    uniqueIndex('uq_one_active_domain_per_business')
      .on(t.businessId)
      .where(sql`status = 'ACTIVE'`),
    index('idx_custom_domains_business').on(t.businessId),
  ],
);

export type CustomDomain = typeof customDomains.$inferSelect;

import { char, index, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { qrStatus } from './enums';
import { businesses } from './business';

/**
 * Dynamic QR sources (ADR-002, D-026).
 *
 * `code` is opaque and immutable for the life of the row (QR-01-01) — a printed standee must
 * stay valid when the slug, Google URL, review mode or custom domain changes. There is
 * deliberately no delete path: QR-01 offers disable only, so a retired standee resolves to a
 * controlled state rather than a 404.
 */
export const qrCodes = pgTable(
  'qr_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    code: varchar('code', { length: 32 }).notNull().unique(),
    sourceLabel: varchar('source_label', { length: 120 }).notNull(),
    internalNote: varchar('internal_note', { length: 500 }),
    status: qrStatus('status').notNull().default('ACTIVE'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_qr_business').on(t.businessId)],
);

/**
 * Anonymous public visitors.
 *
 * No customer account ever exists (D-008), so this is the only identity the public flow has.
 * Per 13_Security_Privacy_Compliance.md only privacy-preserving hashes are retained — never a
 * raw IP — and AN-01-02 requires this be treated as a session, not a person.
 *
 * Scoped per business by design: a visitor to two businesses is two sessions, which keeps the
 * unique-visitor metric tenant-local and stops the token being a cross-tenant correlator.
 */
export const anonymousSessions = pgTable(
  'anonymous_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    publicTokenHash: char('public_token_hash', { length: 64 }).notNull().unique(),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    userAgentHash: char('user_agent_hash', { length: 64 }),
    ipPrefixHash: char('ip_prefix_hash', { length: 64 }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('idx_anon_business_seen').on(t.businessId, t.firstSeenAt)],
);

export type QrCode = typeof qrCodes.$inferSelect;
export type AnonymousSession = typeof anonymousSessions.$inferSelect;

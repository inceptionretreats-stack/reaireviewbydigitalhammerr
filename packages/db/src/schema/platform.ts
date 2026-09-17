import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  check,
  index,
  jsonb,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { businesses } from './business';
import { users } from './identity';

/**
 * Immutable audit trail (ADMIN-01-02, ADMIN-02-03, RBAC rule 5).
 *
 * Every privileged mutation writes here with actor, target and before/after state; high-risk
 * actions additionally require a reason (ADMIN_REASON_REQUIRED). Nothing in the application
 * updates or deletes these rows — enforce with a revoked UPDATE/DELETE grant on the app role.
 *
 * AMENDMENT-029: a mutation the platform makes on its own — the nightly expiry sweep, a refund
 * initiated from the Razorpay dashboard — has no admin behind it. Those rows carry
 * actor_type = 'SYSTEM' and no actor; the CHECK keeps every ADMIN row pinned to a person.
 */
export const adminAuditLogs = pgTable(
  'admin_audit_logs',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    actorType: varchar('actor_type', { length: 16 }).notNull().default('ADMIN'),
    businessId: uuid('business_id').references(() => businesses.id),
    action: varchar('action', { length: 120 }).notNull(),
    reason: varchar('reason', { length: 1000 }),
    targetType: varchar('target_type', { length: 80 }),
    targetId: varchar('target_id', { length: 120 }),
    beforeState: jsonb('before_state'),
    afterState: jsonb('after_state'),
    ipHash: char('ip_hash', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_audit_actor_time').on(t.actorUserId, t.createdAt.desc()),
    index('idx_audit_business_time').on(t.businessId, t.createdAt.desc()),
    index('idx_audit_action_time').on(t.action, t.createdAt.desc()),
    check('ck_audit_actor_present', sql`actor_type = 'SYSTEM' OR actor_user_id IS NOT NULL`),
  ],
);

/**
 * AMENDMENT-028 — what signed-in people did (owner and admin alike).
 *
 * Not analytics_events: that table is the customer-facing funnel, partitioned, typed from the
 * frozen taxonomy, business-scoped and dropped after 13 months. A security log needs a nullable
 * business (a failed login has none), free-form actions, and the 90–180 day retention
 * 13_Security_Privacy_Compliance.md asks for. Only a hash of the address is ever stored.
 */
export const userActivityLogs = pgTable(
  'user_activity_logs',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    businessId: uuid('business_id').references(() => businesses.id, { onDelete: 'set null' }),
    sessionId: uuid('session_id'),
    action: varchar('action', { length: 80 }).notNull(),
    outcome: varchar('outcome', { length: 16 }).notNull().default('SUCCESS'),
    targetType: varchar('target_type', { length: 80 }),
    targetId: varchar('target_id', { length: 120 }),
    metadata: jsonb('metadata').notNull().default({}),
    ipHash: char('ip_hash', { length: 64 }),
    userAgent: varchar('user_agent', { length: 400 }),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_activity_business_time').on(t.businessId, t.occurredAt.desc()),
    index('idx_activity_user_time').on(t.userId, t.occurredAt.desc()),
    index('idx_activity_action_time').on(t.action, t.occurredAt.desc()),
    index('idx_activity_time').on(t.occurredAt.desc()),
    check('ck_activity_outcome', sql`outcome IN ('SUCCESS', 'FAILURE', 'DENIED')`),
  ],
);

export const featureFlags = pgTable('feature_flags', {
  key: varchar('key', { length: 120 }).primaryKey(),
  description: varchar('description', { length: 500 }),
  isEnabled: boolean('is_enabled').notNull().default(false),
  config: jsonb('config').notNull().default({}),
  updatedBy: uuid('updated_by').references(() => users.id),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Commercial and platform configuration (ADMIN-04).
 *
 * The database is the source of truth; environment variables only bootstrap defaults
 * (15_Environment_Variables.example). Version is bumped on every publish so ADMIN-04-01
 * ("config changes versioned/audited") is satisfiable, and ADMIN-04-02 holds because
 * historical payments store their own amount rather than referencing current price.
 */
export const platformSettings = pgTable('platform_settings', {
  key: varchar('key', { length: 120 }).primaryKey(),
  value: jsonb('value').notNull(),
  version: bigint('version', { mode: 'number' }).notNull().default(1),
  updatedBy: uuid('updated_by').references(() => users.id),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type AdminAuditLog = typeof adminAuditLogs.$inferSelect;
export type UserActivityLog = typeof userActivityLogs.$inferSelect;
export type FeatureFlag = typeof featureFlags.$inferSelect;
export type PlatformSetting = typeof platformSettings.$inferSelect;

import {
  bigint,
  boolean,
  char,
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
 */
export const adminAuditLogs = pgTable(
  'admin_audit_logs',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    actorUserId: uuid('actor_user_id')
      .notNull()
      .references(() => users.id),
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
export type FeatureFlag = typeof featureFlags.$inferSelect;
export type PlatformSetting = typeof platformSettings.$inferSelect;

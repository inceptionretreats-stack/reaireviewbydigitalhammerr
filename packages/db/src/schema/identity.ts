import { sql } from 'drizzle-orm';
import {
  bigint,
  char,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { citext, userRole } from './enums';

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: citext('email').notNull().unique(),
    mobile: varchar('mobile', { length: 20 }),
    fullName: varchar('full_name', { length: 120 }).notNull(),
    passwordHash: text('password_hash').notNull(),
    role: userRole('role').notNull().default('BUSINESS_OWNER'),

    // AMENDMENT-007 — MFA is mandatory for SUPER_ADMIN per 13_Security_Privacy_Compliance.md
    // and 19_Admin_Panel_Spec.md, but 06_Database_Schema.sql carried no columns for it.
    // The secret is sealed with APP_ENCRYPTION_KEY (packages/core/src/crypto/secret-box.ts);
    // the enrolment and challenge flow is AMENDMENT-027.
    mfaSecret: text('mfa_secret'),
    mfaEnabledAt: timestamp('mfa_enabled_at', { withTimezone: true }),
    // The last TOTP step that was accepted, so a code can never be replayed inside its window.
    mfaLastUsedStep: bigint('mfa_last_used_step', { mode: 'bigint' }),
    // An admin disabled by another admin (AMENDMENT-027). Distinct from deleted_at: the row and
    // its audit trail stay, only sign-in stops.
    disabledAt: timestamp('disabled_at', { withTimezone: true }),
    disabledReason: varchar('disabled_reason', { length: 500 }),

    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [index('idx_users_role').on(t.role)],
);

/**
 * AMENDMENT-001 — sessions.
 *
 * 06_Database_Schema.sql had no session storage at all, yet SET-01 requires "Log out other
 * sessions", AC-002 requires identifier rotation after login, and 13_Security_Privacy_Compliance.md
 * requires rotation on password reset. None of those are possible against a stateless token,
 * and Redis alone would lose sessions on eviction. Sessions are therefore durable rows here,
 * with Redis used only as a read-through cache in front of this table.
 *
 * Only the hash of the session token is stored, never the token itself.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: char('token_hash', { length: 64 }).notNull().unique(),
    userAgent: varchar('user_agent', { length: 400 }),
    ipHash: char('ip_hash', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: varchar('revoked_reason', { length: 80 }),
    // Set when the session passed the MFA challenge (AMENDMENT-027). An admin session without
    // it can reach only the challenge and enrolment screens.
    mfaVerifiedAt: timestamp('mfa_verified_at', { withTimezone: true }),
  },
  (t) => [
    index('idx_sessions_user_active').on(t.userId, t.expiresAt),
    index('idx_sessions_expiry').on(t.expiresAt),
  ],
);

/**
 * AMENDMENT-002 — password reset tokens.
 *
 * AUTH-03 requires a single-use, expiring reset token; no table existed. `usedAt` enforces
 * single use, and the neutral-response requirement in AUTH-03-01 is a handler concern.
 */
export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: char('token_hash', { length: 64 }).notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    requestedIpHash: char('ip_hash', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_reset_tokens_user').on(t.userId, t.createdAt)],
);

/**
 * AMENDMENT-008 — invites for Digital Hammerr-assisted account creation (Flow B).
 *
 * 04_User_Flows.md Flow B step 2 requires a secure invite / set-password link, but no table
 * backed it. Storage is defined now; the admin-side flow is built in E12.
 */
export const userInvites = pgTable(
  'user_invites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: citext('email').notNull(),
    mobile: varchar('mobile', { length: 20 }),
    invitedByUserId: uuid('invited_by_user_id')
      .notNull()
      .references(() => users.id),
    businessId: uuid('business_id'),
    // AMENDMENT-027: the same table carries admin and support-viewer invites.
    role: userRole('role').notNull().default('BUSINESS_OWNER'),
    fullName: varchar('full_name', { length: 120 }),
    tokenHash: char('token_hash', { length: 64 }).notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_invites_email').on(t.email, t.createdAt)],
);

/**
 * AMENDMENT-027 — one-time MFA recovery codes.
 *
 * Only the peppered SHA-256 of a code is stored, the same class of secret as a session or
 * invite token. A row is consumed with one conditional UPDATE, so two submissions of the same
 * code cannot both succeed.
 */
export const mfaRecoveryCodes = pgTable(
  'mfa_recovery_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    codeHash: char('code_hash', { length: 64 }).notNull().unique(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_mfa_recovery_user')
      .on(t.userId)
      .where(sql`used_at IS NULL`),
  ],
);

export const isSessionLive = sql`revoked_at IS NULL AND expires_at > now()`;

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;
export type UserInvite = typeof userInvites.$inferSelect;
export type MfaRecoveryCode = typeof mfaRecoveryCodes.$inferSelect;

import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { sessions, users } from '@ai-review/db';
import type { Executor } from '../db-executor';
import { hashToken, issueToken } from './tokens';

/**
 * Session lifecycle (AUTH-02, SET-01, AC-002).
 *
 * Sessions are durable rows (AMENDMENT-001) because three requirements are impossible without
 * them: revoking other sessions (SET-01), rotating the identifier after login (AC-002), and
 * invalidating everything on password reset (13_Security_Privacy_Compliance.md).
 *
 * Only the SHA-256 of each token is stored, so a database disclosure does not hand over live
 * sessions.
 */

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const REMEMBER_ME_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * AMENDMENT-027 — admin sessions. A session that has not passed the MFA challenge lives ten
 * minutes, long enough to find the phone; one that has lives twelve hours and never honours
 * remember-me. A step-up (re-entering a code for a high-risk action) is fresh for fifteen.
 */
export const MFA_PENDING_TTL_MS = 10 * 60 * 1000;
export const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const MFA_STEP_UP_MAX_AGE_MS = 15 * 60 * 1000;

export type UserRole = 'BUSINESS_OWNER' | 'BUSINESS_SUPPORT_VIEWER' | 'SUPER_ADMIN';

/** The two roles that use the admin area, and therefore MFA (05_RBAC). */
export function isAdminRole(role: UserRole): boolean {
  return role === 'SUPER_ADMIN' || role === 'BUSINESS_SUPPORT_VIEWER';
}

export interface SessionContext {
  sessionId: string;
  userId: string;
  role: UserRole;
  expiresAt: Date;
  /** When this session passed the MFA challenge; null for a pending admin session or an owner. */
  mfaVerifiedAt: Date | null;
  /** Whether the account has MFA armed at all — decides enrol vs challenge. */
  mfaEnabledAt: Date | null;
}

export interface CreateSessionInput {
  userId: string;
  userAgent?: string | null;
  ipHash?: string | null;
  rememberMe?: boolean;
  /** Explicit lifetime; wins over rememberMe. Admin logins set this. */
  ttlMs?: number;
}

export class SessionService {
  constructor(private readonly db: Executor) {}

  /** Returns the plaintext token exactly once; only its hash is persisted. */
  async create(input: CreateSessionInput): Promise<{ token: string; expiresAt: Date }> {
    const { token, tokenHash } = issueToken();
    const ttl = input.ttlMs ?? (input.rememberMe ? REMEMBER_ME_TTL_MS : SESSION_TTL_MS);
    const expiresAt = new Date(Date.now() + ttl);

    await this.db.insert(sessions).values({
      userId: input.userId,
      tokenHash,
      userAgent: input.userAgent ?? null,
      ipHash: input.ipHash ?? null,
      expiresAt,
    });

    return { token, expiresAt };
  }

  /**
   * Resolves a token to its session, or null. Also advances lastSeenAt.
   *
   * Never distinguishes "expired", "revoked" and "unknown" to the caller — all three are
   * simply "no session", so the endpoint cannot be used to probe token validity.
   */
  async resolve(token: string): Promise<SessionContext | null> {
    const tokenHash = hashToken(token);

    const [row] = await this.db
      .select({
        sessionId: sessions.id,
        userId: sessions.userId,
        expiresAt: sessions.expiresAt,
        mfaVerifiedAt: sessions.mfaVerifiedAt,
        role: users.role,
        deletedAt: users.deletedAt,
        disabledAt: users.disabledAt,
        mfaEnabledAt: users.mfaEnabledAt,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(
        and(
          eq(sessions.tokenHash, tokenHash),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, new Date()),
        ),
      )
      .limit(1);

    // A disabled admin's sessions die with the account, without a separate sweep.
    if (!row || row.deletedAt || row.disabledAt) return null;

    await this.db
      .update(sessions)
      .set({ lastSeenAt: new Date() })
      .where(eq(sessions.id, row.sessionId));

    return {
      sessionId: row.sessionId,
      userId: row.userId,
      role: row.role,
      expiresAt: row.expiresAt,
      mfaVerifiedAt: row.mfaVerifiedAt,
      mfaEnabledAt: row.mfaEnabledAt,
    };
  }

  /**
   * Stamps the session as MFA-verified. On the first verification the pending ten-minute
   * lifetime becomes the full admin lifetime; a later step-up only refreshes the stamp and
   * never extends the session, so twelve hours means twelve hours.
   */
  async markMfaVerified(sessionId: string, options: { extendToMs: number }): Promise<Date> {
    const now = new Date();
    const [row] = await this.db
      .update(sessions)
      .set({
        mfaVerifiedAt: now,
        expiresAt: sql`CASE WHEN ${sessions.mfaVerifiedAt} IS NULL THEN ${new Date(now.getTime() + options.extendToMs)} ELSE ${sessions.expiresAt} END`,
      })
      .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)))
      .returning({ expiresAt: sessions.expiresAt });
    return row?.expiresAt ?? now;
  }

  /**
   * AC-002: issues a new identifier and revokes the old one in one step, so a token captured
   * before authentication cannot be replayed after it (session fixation).
   */
  async rotate(
    currentSessionId: string,
    input: CreateSessionInput,
  ): Promise<{ token: string; expiresAt: Date }> {
    const next = await this.create(input);
    await this.revoke(currentSessionId, 'ROTATED');
    return next;
  }

  async revoke(sessionId: string, reason: string): Promise<void> {
    await this.db
      .update(sessions)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
  }

  /** SET-01 "Log out other sessions", and the mandatory sweep after a password change. */
  async revokeAllForUser(
    userId: string,
    reason: string,
    exceptSessionId?: string,
  ): Promise<number> {
    const rows = await this.db
      .update(sessions)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(
        and(
          eq(sessions.userId, userId),
          isNull(sessions.revokedAt),
          exceptSessionId ? sql`${sessions.id} <> ${exceptSessionId}` : undefined,
        ),
      )
      .returning({ id: sessions.id });

    return rows.length;
  }

  /** Housekeeping for the worker; expired rows are already unusable via resolve(). */
  async purgeExpired(olderThan = new Date()): Promise<number> {
    const rows = await this.db
      .delete(sessions)
      .where(sql`${sessions.expiresAt} < ${olderThan}`)
      .returning({ id: sessions.id });

    return rows.length;
  }
}

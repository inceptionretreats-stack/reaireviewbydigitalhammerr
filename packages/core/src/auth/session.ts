import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { sessions, users, type Database } from '@ai-review/db';
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

export interface SessionContext {
  sessionId: string;
  userId: string;
  role: 'BUSINESS_OWNER' | 'BUSINESS_SUPPORT_VIEWER' | 'SUPER_ADMIN';
  expiresAt: Date;
}

export interface CreateSessionInput {
  userId: string;
  userAgent?: string | null;
  ipHash?: string | null;
  rememberMe?: boolean;
}

export class SessionService {
  constructor(private readonly db: Database) {}

  /** Returns the plaintext token exactly once; only its hash is persisted. */
  async create(input: CreateSessionInput): Promise<{ token: string; expiresAt: Date }> {
    const { token, tokenHash } = issueToken();
    const ttl = input.rememberMe ? REMEMBER_ME_TTL_MS : SESSION_TTL_MS;
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
        role: users.role,
        deletedAt: users.deletedAt,
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

    if (!row || row.deletedAt) return null;

    await this.db
      .update(sessions)
      .set({ lastSeenAt: new Date() })
      .where(eq(sessions.id, row.sessionId));

    return {
      sessionId: row.sessionId,
      userId: row.userId,
      role: row.role,
      expiresAt: row.expiresAt,
    };
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

import { and, count, eq, gt, isNull, ne } from 'drizzle-orm';
import { sessions, type Database } from '@ai-review/db';

/**
 * The session-count arithmetic behind SET-01-02, "session revocation works".
 *
 * Server-only, and shared by `POST /account/sessions/revoke-others`, `POST /account/password` and
 * the settings screen's loader — which is why it sits here rather than inside any one of them. It
 * belongs in `apps/web/lib/`; it is here only because this build is split across concurrent
 * workstreams and that directory is not this module's to write.
 *
 * Why a count of our own, when `SessionService.revokeAllForUser` already returns one.
 *
 * That method revokes every row where `revoked_at IS NULL`, which correctly includes sessions that
 * have already expired: `resolve()` refuses them, so they were not usable, but nothing had marked
 * them revoked. Reporting its return value as "3 other devices were signed out" would therefore
 * count dead rows as devices. SET-01-02 asks for the action to have visible effect, and a number
 * inflated by rows that were already unusable is a worse answer than a smaller true one — an owner
 * who reads "3" on a machine they have used once starts hunting for an intruder.
 *
 * So the live sessions are counted first and the reported figure is the smaller of the two:
 * `revokeAllForUser` can only ever revoke at least as many rows as were live, and taking the
 * minimum means the number never claims more than actually happened. A session created in the gap
 * between the count and the sweep is revoked but not reported, which understates by one in a race
 * that requires a second sign-in mid-request; overstating would be the worse direction.
 */
export async function countOtherLiveSessions(
  database: Database,
  userId: string,
  currentSessionId: string,
  now: Date = new Date(),
): Promise<number> {
  // Counted in the database rather than by fetching rows: the answer is one number, and session
  // rows carry a user-agent string and an IP hash that this screen has no reason to read.
  const [row] = await database
    .select({ total: count() })
    .from(sessions)
    .where(
      and(
        eq(sessions.userId, userId),
        ne(sessions.id, currentSessionId),
        isNull(sessions.revokedAt),
        // Live, not merely unrevoked — the same three conditions SessionService.resolve applies,
        // so this counts exactly the sessions that could still be used.
        gt(sessions.expiresAt, now),
      ),
    );

  return row?.total ?? 0;
}

/** The honest figure to report, given a pre-sweep live count and what the sweep revoked. */
export function reportableRevoked(liveBefore: number, revoked: number): number {
  return Math.max(0, Math.min(liveBefore, revoked));
}

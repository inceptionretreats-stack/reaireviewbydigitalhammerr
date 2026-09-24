import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/lib/infra/db';
import { apiError } from '@/lib/http/api-error';
import { requireTenant } from '@/lib/tenant/require-tenant';
import { sessionService } from '@/lib/auth/session';
import { countOtherLiveSessions, reportableRevoked } from '@/lib/account/session-count';
import { recordActivity } from '@/lib/activity/recorder';
import { safeError } from '@/lib/infra/safe-error';

/**
 * POST /api/v1/account/sessions/revoke-others — "Log out other sessions" on SET-01.
 *
 * SET-01-02 is the whole point: revocation must actually work. It can here because sessions are
 * durable rows (AMENDMENT-001) — against a stateless token there would be nothing to revoke, and
 * this button would be a lie. `revokeAllForUser` excepts the caller's own session id, so every
 * other session is ended and the owner stays where they are; the alternative, signing them out
 * too, means the one action that secures an account also punishes the person taking it.
 *
 * Scoping comes from the session and nothing else. `requireTenant` resolves the caller, and the
 * sweep is keyed on their own `userId`, so there is no id in the URL or body that could revoke
 * another person's sessions (RBAC rule 2, AC-003).
 *
 * Deliberately NOT re-authenticated, which is SET-01-01's "where appropriate" read honestly. This
 * action grants nothing: it cannot read data, change a credential or lock anybody out but the
 * caller's own other devices, and its worst outcome is an owner signing themselves out of a laptop.
 * It is also the action someone takes in a hurry, having just realised they left a session open on
 * a shared machine — putting a password prompt in front of that makes the account less safe, not
 * more. A password change, which does hand over control, is where the prompt belongs.
 *
 * Not rate limited, for the same reason: it is idempotent, affects only the caller, and a second
 * call revokes nothing because the first already did. Repeating it costs one UPDATE and returns 0.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireTenant(request);
  if (!auth.ok) return auth.response;

  const { userId, sessionId } = auth.context.session;
  const database = db();

  try {
    // Counted before the sweep, because afterwards there is nothing left to count. See
    // ../../session-count.ts for why this figure, and not the raw revoked-row count, is what is
    // reported: unrevoked-but-expired rows are swept too, and they were never live devices.
    const liveBefore = await countOtherLiveSessions(database, userId, sessionId);
    const revoked = await sessionService().revokeAllForUser(
      userId,
      'USER_REVOKED_OTHER_SESSIONS',
      sessionId,
    );

    recordActivity(
      request,
      { session: auth.context.session, businessId: auth.context.businessId },
      {
        action: 'auth.sessions.revoke_others',
        metadata: { revoked: reportableRevoked(liveBefore, revoked) },
      },
    );
    return NextResponse.json({
      // SET-01-02 asks for the action to have visible effect, and a bare 204 has none — an owner
      // cannot tell a successful sweep from a button that did nothing. The screen turns this into
      // a sentence, including the honest "nothing to sign out" case.
      other_sessions_signed_out: reportableRevoked(liveBefore, revoked),
    });
  } catch (error) {
    console.error('[account] revoking other sessions failed', safeError(error));
    return apiError('INTERNAL_ERROR', 'We could not sign out your other sessions. Please retry.');
  }
}

import { NextResponse, type NextRequest } from 'next/server';
import { apiError } from '@/lib/api-error';
import { verifyCsrf } from '@/lib/csrf';
import { clearSessionCookie, getSession, sessionService } from '@/lib/session';
import { recordActivity } from '@/lib/activity';

/**
 * POST /api/v1/auth/logout — revokes the session row and clears the cookie.
 *
 * Both halves matter. Clearing the cookie alone would leave a live row that an already-captured
 * token could still present; revoking alone would leave the browser sending a dead cookie on
 * every request. SET-01's "log out other sessions" is a separate operation on the settings
 * screen, which revokes siblings rather than the caller's own.
 *
 * Returns 204 whether or not a session was found: logging out is idempotent, and a client
 * clearing state should never have to handle an error for having no session to clear.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const csrf = verifyCsrf(request);
  if (!csrf.ok) return apiError('FORBIDDEN', 'Request rejected.');

  const session = await getSession();
  if (session) {
    await sessionService().revoke(session.sessionId, 'USER_LOGOUT');
  }

  if (session) recordActivity(request, { session }, { action: 'auth.logout' });
  await clearSessionCookie();
  return new NextResponse(null, { status: 204 });
}

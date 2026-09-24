import type { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { users } from '@ai-review/db';
import { privacyHash } from '@ai-review/core';
import { db } from './db';
import { env } from './env';
import { clientIp } from './rate-limit';
import { getSession, sessionService, setSessionCookie } from './session';

/** Replace any browser session before signing in a Google-authenticated vendor. */
export async function signInGoogleVendor(request: NextRequest, userId: string): Promise<void> {
  await db()
    .update(users)
    .set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() })
    .where(eq(users.id, userId));

  const existing = await getSession();
  if (existing) await sessionService().revoke(existing.sessionId, 'REPLACED_BY_LOGIN');

  const ip = clientIp(request);
  const session = await sessionService().create({
    userId,
    userAgent: request.headers.get('user-agent'),
    ipHash: ip ? privacyHash(ip, env().HASH_PEPPER) : null,
  });
  await setSessionCookie(session.token, session.expiresAt);
}

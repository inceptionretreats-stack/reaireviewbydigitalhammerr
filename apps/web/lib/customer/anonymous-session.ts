import { cookies } from 'next/headers';
import { createHash } from 'node:crypto';
import { and, eq, gt } from 'drizzle-orm';
import { anonymousSessions } from '@ai-review/db';
import { ipPrefixHash, privacyHash } from '@ai-review/core';
import { db } from '../infra/db';
import { env } from '../infra/env';

/**
 * Anonymous public session (E3-02).
 *
 * The customer never has an account (D-008), so this is the only continuity the public flow
 * has: it ties a scan to a generation to a copy to a Google open, which is what makes the
 * funnel in AN-01 possible at all.
 *
 * This module only ever READS the cookie. The token is minted by middleware.ts, because an
 * RSC cannot write cookies — see the note there.
 *
 * 13_Security_Privacy_Compliance.md governs what is retained: never a raw IP, only a peppered
 * hash of its network prefix, which supports rate limiting without keeping an identifier for a
 * person. AN-01-02 is explicit that this is a session, not a person.
 */

const COOKIE_NAME = 'dh_anon';
const SESSION_TTL_DAYS = 30;

export interface AnonymousSessionContext {
  sessionId: string;
  businessId: string;
}

/**
 * Derives the stored hash from the browser token AND the business.
 *
 * anonymous_sessions.public_token_hash is globally UNIQUE while business_id is NOT NULL, so
 * hashing the bare token would let one browser hold a session for only one business ever — the
 * second business it visited would collide on insert. Binding the business into the hash gives
 * the per-business scoping the schema intends, and has the useful property that the stored
 * value is not a cross-tenant correlator.
 */
function sessionHash(token: string, businessId: string): string {
  return createHash('sha256').update(`${token}:${businessId}`).digest('hex');
}

/**
 * Resolves — creating on first use — the session for this browser and business.
 *
 * Returns null when no token cookie is present (a client that rejects cookies, or a request
 * that bypassed middleware). Callers must treat that as "no analytics", never as an error:
 * AC-035 requires the customer journey to continue regardless.
 */
export async function resolveAnonymousSession(
  request: Request,
  businessId: string,
): Promise<AnonymousSessionContext | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const tokenHash = sessionHash(token, businessId);

  const [existing] = await db()
    .select({ id: anonymousSessions.id })
    .from(anonymousSessions)
    .where(
      and(
        eq(anonymousSessions.publicTokenHash, tokenHash),
        eq(anonymousSessions.businessId, businessId),
        gt(anonymousSessions.expiresAt, new Date()),
      ),
    )
    .limit(1);

  if (existing) return { sessionId: existing.id, businessId };

  const pepper = env().HASH_PEPPER;
  const ip = (request.headers.get('x-forwarded-for') ?? '').split(',')[0]?.trim() ?? '';
  const userAgent = request.headers.get('user-agent') ?? '';

  // onConflictDoNothing covers the race where two requests from the same browser (the page
  // render and its first beacon) both miss the select and both insert.
  await db()
    .insert(anonymousSessions)
    .values({
      businessId,
      publicTokenHash: tokenHash,
      userAgentHash: userAgent ? privacyHash(userAgent, pepper) : null,
      ipPrefixHash: ip ? ipPrefixHash(ip, pepper) : null,
      expiresAt: new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000),
    })
    .onConflictDoNothing();

  // The same predicates as the first lookup. Filtering on the token hash alone meant that a
  // row which existed but had EXPIRED was handed back and used as a live session: the first
  // SELECT missed it on `expires_at`, the INSERT was a no-op on the unique index, and this
  // recovery read then found it anyway. Nothing purges anonymous_sessions, so the 30-day TTL
  // that /legal/privacy states was enforced only by the cookie's own maxAge happening to
  // match — a coincidence, not a guarantee.
  const [row] = await db()
    .select({ id: anonymousSessions.id })
    .from(anonymousSessions)
    .where(
      and(
        eq(anonymousSessions.publicTokenHash, tokenHash),
        eq(anonymousSessions.businessId, businessId),
        gt(anonymousSessions.expiresAt, new Date()),
      ),
    )
    .limit(1);

  return row ? { sessionId: row.id, businessId } : null;
}

import { NextResponse } from 'next/server';
import { privacyHash, type SessionContext } from '@ai-review/core';
import { apiError } from './api-error';
import { verifyCsrf } from './csrf';
import { env } from './env';
import { clientIp } from './rate-limit';
import { getSession } from './session';

/**
 * The single entry point for an admin route handler (RBAC rule 4: "Admin endpoints use
 * separate middleware/guards").
 *
 * Deliberately not `requireTenant` with a role check bolted on. That helper resolves the
 * caller's own business, and an admin has none — so every tenant route answers an admin with
 * "we could not find your business", which is the right answer: an admin acting on a tenant
 * goes through these routes, names the business explicitly, and is audited for it.
 *
 * What comes back is the actor the audit writer needs — user id and a privacy-hashed IP — so
 * a handler cannot write an audit row without them.
 *
 * MFA (19_Admin_Panel_Spec: "MFA mandatory") is E13 and not enforced here. Until it is, an
 * admin account must not exist on a publicly reachable deployment; `pnpm admin:create` says so.
 */

export interface AdminContext {
  session: SessionContext;
  actor: { userId: string; ipHash: string | null };
}

export type AdminOutcome =
  { ok: true; context: AdminContext } | { ok: false; response: NextResponse };

export async function requireAdmin(request: Request): Promise<AdminOutcome> {
  const csrf = verifyCsrf(request);
  if (!csrf.ok) {
    return { ok: false, response: apiError('FORBIDDEN', 'Request rejected.') };
  }

  const session = await getSession();
  if (!session) {
    return { ok: false, response: apiError('AUTH_REQUIRED', 'Please sign in and try again.') };
  }

  // A signed-in owner is told exactly the same thing as a stranger. There is nothing here for
  // them, and confirming that the route exists is not owed to anyone but an admin.
  if (session.role !== 'SUPER_ADMIN') {
    return { ok: false, response: apiError('FORBIDDEN', 'Request rejected.') };
  }

  const ip = clientIp(request);
  return {
    ok: true,
    context: {
      session,
      actor: { userId: session.userId, ipHash: ip ? privacyHash(ip, env().HASH_PEPPER) : null },
    },
  };
}

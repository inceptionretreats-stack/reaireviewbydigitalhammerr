import { NextResponse } from 'next/server';
import {
  MFA_STEP_UP_MAX_AGE_MS,
  isAdminRole,
  privacyHash,
  type SessionContext,
  type UserRole,
} from '@ai-review/core';
import { apiError } from '@/lib/http/api-error';
import { verifyCsrf } from '@/lib/http/csrf';
import { env } from '@/lib/infra/env';
import { clientIp } from '@/lib/http/rate-limit';
import { adminMfaRequired, getSession } from './session';

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
 * AMENDMENT-027 — MFA is mandatory (19_Admin_Panel_Spec). A session that has not passed the
 * challenge is refused with AUTH_MFA_REQUIRED, whatever its role; a handler that asks for
 * `stepUp` also refuses a verification older than fifteen minutes, so an unattended twelve-hour
 * session cannot refund money or change a role by itself. `allowViewer` opens a read-only route
 * to BUSINESS_SUPPORT_VIEWER (05_RBAC); every mutation stays SUPER_ADMIN only.
 */

export interface AdminContext {
  session: SessionContext;
  role: UserRole;
  actor: { userId: string; ipHash: string | null };
}

export interface RequireAdminOptions {
  /** Let a support viewer through. Only for GET routes that mutate nothing. */
  allowViewer?: boolean;
  /** Demand an MFA verification fresher than MFA_STEP_UP_MAX_AGE_MS. */
  stepUp?: boolean;
}

export type AdminOutcome =
  { ok: true; context: AdminContext } | { ok: false; response: NextResponse };

export async function requireAdmin(
  request: Request,
  options: RequireAdminOptions = {},
): Promise<AdminOutcome> {
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
  const permitted =
    session.role === 'SUPER_ADMIN' ||
    (options.allowViewer === true && session.role === 'BUSINESS_SUPPORT_VIEWER');
  if (!isAdminRole(session.role) || !permitted) {
    return { ok: false, response: apiError('FORBIDDEN', 'Request rejected.') };
  }

  // With the switch off there is no code to confirm and nothing to step up to.
  const mfaRequired = adminMfaRequired();
  if (mfaRequired && !session.mfaVerifiedAt) {
    return {
      ok: false,
      response: apiError('AUTH_MFA_REQUIRED', 'Confirm the code from your authenticator app.'),
    };
  }

  if (
    mfaRequired &&
    options.stepUp &&
    Date.now() - (session.mfaVerifiedAt?.getTime() ?? 0) > MFA_STEP_UP_MAX_AGE_MS
  ) {
    return {
      ok: false,
      response: apiError(
        'AUTH_MFA_STEP_UP_REQUIRED',
        'Enter a fresh code from your authenticator app to continue.',
      ),
    };
  }

  const ip = clientIp(request);
  return {
    ok: true,
    context: {
      session,
      role: session.role,
      actor: { userId: session.userId, ipHash: ip ? privacyHash(ip, env().HASH_PEPPER) : null },
    },
  };
}

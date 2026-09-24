import { NextResponse } from 'next/server';
import {
  isAdminRole,
  TenantGuard,
  type ResolvedTenant,
  type SessionContext,
} from '@ai-review/core';
import { db } from './db';
import { apiError } from './api-error';
import { verifyCsrf } from './csrf';
import { adminMfaRequired, getSession } from './session';

/**
 * The single entry point for an authenticated tenant-scoped route handler.
 *
 * RBAC rule 2 is the reason this exists in one place: "Never trust business_id from browser for
 * scoping. Resolve active tenant from session and compare resource ownership." A helper that
 * every handler must call, returning a branded ResolvedTenant that repositories demand, turns
 * forgetting the check into a type error rather than a silent cross-tenant read (AC-003).
 *
 * CSRF is verified here too rather than per handler, for the same reason: a mutation that forgets
 * it is indistinguishable from one that does not need it, until it matters.
 */

export interface AuthenticatedContext {
  session: SessionContext;
  businessId: ResolvedTenant;
  /** Tenant status, so a handler can decide whether it requires an ACTIVE tenant (Flow J). */
  status: string;
}

export type TenantOutcome =
  { ok: true; context: AuthenticatedContext } | { ok: false; response: NextResponse };

export async function requireTenant(request: Request): Promise<TenantOutcome> {
  const csrf = verifyCsrf(request);
  if (!csrf.ok) {
    return { ok: false, response: apiError('FORBIDDEN', 'Request rejected.') };
  }

  const session = await getSession();
  if (!session) {
    return { ok: false, response: apiError('AUTH_REQUIRED', 'Please sign in and try again.') };
  }

  // AMENDMENT-027: an admin who has given only their password holds a ten-minute *pending*
  // session that "can reach only the MFA screens". requireAdmin enforced that for /admin, but
  // nothing enforced it here — so the password alone was enough to change that admin's own
  // password (sweeping the real admin's live sessions) and their sign-in email, and to read
  // and modify any business the account owns. That is the entire account-recovery surface,
  // which is precisely what the second factor is there to protect.
  if (isAdminRole(session.role) && adminMfaRequired() && !session.mfaVerifiedAt) {
    return {
      ok: false,
      response: apiError('AUTH_MFA_REQUIRED', 'Enter your authenticator code to continue.'),
    };
  }

  const guard = new TenantGuard(db());
  const resolved = await guard.resolveActive(session);

  if (!resolved.ok) {
    // A signed-in user with no business is a broken invariant, not a normal state: signup
    // creates the shell in the same transaction as the user. Reported as not-found rather than
    // as a server error, because the caller can do nothing with either.
    return {
      ok: false,
      response: apiError('RESOURCE_NOT_FOUND', 'We could not find your business.'),
    };
  }

  return {
    ok: true,
    context: { session, businessId: resolved.businessId, status: resolved.status },
  };
}

/**
 * For operations that require a live tenant (Flow J): a suspended or closed business must not be
 * able to mutate its own configuration, or a suspension is cosmetic.
 *
 * Onboarding deliberately does NOT use this — it runs entirely against a DRAFT tenant, which is
 * the one state that is legitimately not ACTIVE yet.
 */
export function requireActiveTenant(context: AuthenticatedContext): NextResponse | null {
  if (context.status !== 'ACTIVE') {
    return apiError('BUSINESS_NOT_ACTIVE', 'This business is not active.');
  }
  return null;
}

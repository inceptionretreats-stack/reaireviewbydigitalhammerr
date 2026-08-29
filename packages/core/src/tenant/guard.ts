import { and, eq, isNull } from 'drizzle-orm';
import { businesses, type Database } from '@ai-review/db';
import type { SessionContext } from '../auth/session';

/**
 * Tenant authorization (05_RBAC_Permissions.md, AC-003, ADR-001).
 *
 * The rule the whole multi-tenant model rests on, from RBAC rule 2: *never* trust a
 * business_id from the browser for scoping. The active tenant is resolved from the session and
 * the resource's ownership is compared against it on the server.
 *
 * This is deliberately the only sanctioned way to obtain a business_id for a private query.
 * Everything else in the codebase should take a ResolvedTenant rather than a raw string, so
 * that forgetting the check is a type error rather than a silent IDOR.
 */

export type TenantDenial = 'AUTH_REQUIRED' | 'TENANT_SCOPE_VIOLATION' | 'BUSINESS_NOT_ACTIVE';

/**
 * A business id that has been proven to belong to the current session.
 *
 * The branded type is the point: a plain string cannot be passed where this is expected, so
 * an unchecked id from a request body cannot reach a repository by accident.
 */
export type ResolvedTenant = string & { readonly __tenantChecked: unique symbol };

export type TenantResult =
  { ok: true; businessId: ResolvedTenant; status: string } | { ok: false; reason: TenantDenial };

export class TenantGuard {
  constructor(private readonly db: Database) {}

  /**
   * Resolves the caller's own business. Takes no id from the client at all — there is nothing
   * for a caller to tamper with.
   */
  async resolveActive(session: SessionContext | null): Promise<TenantResult> {
    if (!session) return { ok: false, reason: 'AUTH_REQUIRED' };

    const [row] = await this.db
      .select({ id: businesses.id, status: businesses.status })
      .from(businesses)
      .where(and(eq(businesses.ownerUserId, session.userId), isNull(businesses.deletedAt)))
      .limit(1);

    if (!row) return { ok: false, reason: 'TENANT_SCOPE_VIOLATION' };

    return { ok: true, businessId: row.id as ResolvedTenant, status: row.status };
  }

  /**
   * Confirms a specific business belongs to the session. Used where a route carries an id.
   *
   * SUPER_ADMIN passes, because admin tooling legitimately reaches every tenant — but callers
   * must write an audit entry for that access (ADMIN-01-02), which is why admin access is
   * reported distinctly rather than silently allowed.
   */
  async assertOwnership(
    session: SessionContext | null,
    candidateBusinessId: string,
  ): Promise<TenantResult & { viaAdmin?: boolean }> {
    if (!session) return { ok: false, reason: 'AUTH_REQUIRED' };

    const [row] = await this.db
      .select({
        id: businesses.id,
        status: businesses.status,
        ownerUserId: businesses.ownerUserId,
      })
      .from(businesses)
      .where(and(eq(businesses.id, candidateBusinessId), isNull(businesses.deletedAt)))
      .limit(1);

    // A missing row and someone else's row are reported identically, so the endpoint cannot be
    // used to enumerate which business ids exist.
    if (!row) return { ok: false, reason: 'TENANT_SCOPE_VIOLATION' };

    if (row.ownerUserId !== session.userId) {
      if (session.role === 'SUPER_ADMIN') {
        return {
          ok: true,
          businessId: row.id as ResolvedTenant,
          status: row.status,
          viaAdmin: true,
        };
      }
      return { ok: false, reason: 'TENANT_SCOPE_VIOLATION' };
    }

    return { ok: true, businessId: row.id as ResolvedTenant, status: row.status };
  }

  /** Operations that require a published, non-suspended tenant (Flow J). */
  static requireActive(result: TenantResult): TenantResult {
    if (!result.ok) return result;
    if (result.status !== 'ACTIVE') return { ok: false, reason: 'BUSINESS_NOT_ACTIVE' };
    return result;
  }
}

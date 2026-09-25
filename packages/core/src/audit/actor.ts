import type { AuditActorType } from './writer';

/**
 * Who performed an admin-audited action: a platform admin, or the platform itself.
 *
 * Shared by every service that writes admin audit entries (billing, admin team, MFA resets, abuse
 * handling), so it lives with the audit writer rather than inside any one of them.
 */
export interface AdminActor {
  /** The person acting. Null only when `system` is set (AMENDMENT-029). */
  userId: string | null;
  ipHash?: string | null;
  /** The platform acting on its own — the expiry sweep, a provider-initiated refund. */
  system?: boolean;
}

/** The actor the platform uses for mutations nobody clicked. */
export const SYSTEM_ACTOR: AdminActor = { userId: null, system: true };

export function auditActorType(actor: AdminActor): AuditActorType {
  return actor.system ? 'SYSTEM' : 'ADMIN';
}

export interface AdminAction {
  actor: AdminActor;
  /** Required. The writer refuses a high-risk action without one. */
  reason: string;
}

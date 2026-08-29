import { adminAuditLogs, type Database } from '@ai-review/db';

/**
 * Audit trail (ADMIN-01-02, ADMIN-02-03, RBAC rule 5).
 *
 * Built in Phase 1 rather than retrofitted, because "every admin mutation is audited" is only
 * true if the writer exists before the mutations do.
 *
 * High-risk actions require a reason (ADMIN_REASON_REQUIRED, 23_API_Error_Codes.md), enforced
 * here rather than at each call site so it cannot be forgotten one endpoint at a time.
 */

export const HIGH_RISK_ACTIONS = new Set([
  'business.suspend',
  'business.reactivate',
  'business.entitlement.adjust',
  'business.quota.reset',
  'business.impersonate',
  'prompt_version.activate',
  'prompt_version.rollback',
  'platform_settings.update',
  'user.role.change',
]);

export interface AuditEntry {
  actorUserId: string;
  action: string;
  businessId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  reason?: string | null;
  before?: unknown;
  after?: unknown;
  ipHash?: string | null;
}

export class AuditReasonRequiredError extends Error {
  constructor(action: string) {
    super(`Action ${action} is high-risk and requires a reason`);
    this.name = 'AuditReasonRequiredError';
  }
}

export class AuditWriter {
  constructor(private readonly db: Database) {}

  async record(entry: AuditEntry): Promise<void> {
    if (HIGH_RISK_ACTIONS.has(entry.action) && !entry.reason?.trim()) {
      throw new AuditReasonRequiredError(entry.action);
    }

    await this.db.insert(adminAuditLogs).values({
      actorUserId: entry.actorUserId,
      businessId: entry.businessId ?? null,
      action: entry.action,
      reason: entry.reason ?? null,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      beforeState: entry.before === undefined ? null : (entry.before as object),
      afterState: entry.after === undefined ? null : (entry.after as object),
      ipHash: entry.ipHash ?? null,
    });
  }

  /**
   * Wraps a mutation so the audit entry captures real before/after state.
   *
   * ADMIN-02-03 requires before/after in the log. Reading "before" inside the wrapper is what
   * makes that reliable — a call site that logs after mutating has already lost it.
   */
  async recordAround<T>(
    entry: Omit<AuditEntry, 'before' | 'after'>,
    readState: () => Promise<unknown>,
    mutate: () => Promise<T>,
  ): Promise<T> {
    const before = await readState();
    const result = await mutate();
    const after = await readState();
    await this.record({ ...entry, before, after });
    return result;
  }
}

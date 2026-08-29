import { eq, inArray, sql } from 'drizzle-orm';
import { analyticsEvents, customDomains, type Database } from '@ai-review/db';
import type { DomainVerificationRecord, ObservedDomainState } from './provider';

/**
 * Storage contract for custom-domain polling (DOM-01, AC-027, AMENDMENT-011).
 */

/** Only the two states the worker advances; ACTIVE, ERROR and REMOVED are terminal for it. */
export type PollableDomainStatus = 'PENDING_DNS' | 'PENDING_SSL';

export interface PendingCustomDomain {
  id: string;
  businessId: string;
  hostname: string;
  status: PollableDomainStatus;
  providerHostnameId: string | null;
  activatedAt: Date | null;
}

export interface DomainStatusPatch {
  status?: ObservedDomainState;
  sslStatus?: string | null;
  dnsTarget?: string | null;
  verificationRecords?: DomainVerificationRecord[];
  providerHostnameId?: string | null;
  errorMessage?: string | null;
  activatedAt?: Date;
  checkedAt: Date;
}

export interface CustomDomainStore {
  listPollable(limit: number): Promise<PendingCustomDomain[]>;
  applyStatus(domainId: string, patch: DomainStatusPatch): Promise<void>;
  /** Records custom_domain_activated (actor: System in 11_Analytics_Event_Taxonomy.csv). */
  recordActivation(domain: PendingCustomDomain, providerName: string): Promise<void>;
}

const POLLABLE: readonly PollableDomainStatus[] = ['PENDING_DNS', 'PENDING_SSL'];

export class PostgresCustomDomainStore implements CustomDomainStore {
  constructor(private readonly db: Database) {}

  /**
   * REMOVED rows are excluded by the status filter, which matters more than it looks:
   * AMENDMENT-011 keeps them so a released hostname stays re-claimable, and polling a hostname
   * the tenant has given up would resurrect it.
   *
   * Oldest-checked first, so one permanently stuck hostname cannot starve the rest.
   */
  async listPollable(limit: number): Promise<PendingCustomDomain[]> {
    const rows = await this.db
      .select({
        id: customDomains.id,
        businessId: customDomains.businessId,
        hostname: customDomains.hostname,
        status: customDomains.status,
        providerHostnameId: customDomains.providerHostnameId,
        activatedAt: customDomains.activatedAt,
      })
      .from(customDomains)
      .where(inArray(customDomains.status, [...POLLABLE]))
      .orderBy(sql`${customDomains.lastCheckedAt} asc nulls first`)
      .limit(limit);

    // The WHERE clause already restricts the set; this re-states it in the type system so
    // PendingCustomDomain.status stays honest rather than being asserted.
    return rows.flatMap((row) =>
      row.status === 'PENDING_DNS' || row.status === 'PENDING_SSL'
        ? [{ ...row, status: row.status }]
        : [],
    );
  }

  async applyStatus(domainId: string, patch: DomainStatusPatch): Promise<void> {
    await this.db
      .update(customDomains)
      .set({
        ...(patch.status === undefined ? {} : { status: patch.status }),
        ...(patch.sslStatus === undefined ? {} : { sslStatus: patch.sslStatus }),
        ...(patch.dnsTarget === undefined ? {} : { dnsTarget: patch.dnsTarget }),
        ...(patch.verificationRecords === undefined
          ? {}
          : { verificationRecords: patch.verificationRecords }),
        ...(patch.providerHostnameId === undefined
          ? {}
          : { providerHostnameId: patch.providerHostnameId }),
        ...(patch.errorMessage === undefined ? {} : { errorMessage: patch.errorMessage }),
        // activated_at records the FIRST activation. The caller omits it for a hostname that
        // already carries one, so a domain which flapped to PENDING_SSL and recovered is not
        // recorded as newly activated. Guarding it here instead — with a WHERE on
        // activated_at IS NULL — would silently discard the status update along with it.
        ...(patch.activatedAt === undefined ? {} : { activatedAt: patch.activatedAt }),
        lastCheckedAt: patch.checkedAt,
        updatedAt: patch.checkedAt,
      })
      .where(eq(customDomains.id, domainId));
  }

  async recordActivation(domain: PendingCustomDomain, providerName: string): Promise<void> {
    await this.db.insert(analyticsEvents).values({
      businessId: domain.businessId,
      eventName: 'custom_domain_activated',
      properties: {
        business_id: domain.businessId,
        custom_domain_id: domain.id,
        provider: providerName,
      },
    });
  }
}

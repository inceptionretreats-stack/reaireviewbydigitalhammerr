import type { ObservedDomainState } from './provider';
import type {
  CustomDomainStore,
  DomainStatusPatch,
  PendingCustomDomain,
  PollableDomainStatus,
} from './store';

export interface MemoryDomainRow {
  id: string;
  businessId: string;
  hostname: string;
  /** REMOVED and ACTIVE rows are seeded to prove the job never touches them. */
  status: ObservedDomainState | 'REMOVED';
  providerHostnameId: string | null;
  activatedAt: Date | null;
  lastCheckedAt: Date | null;
  sslStatus: string | null;
  errorMessage: string | null;
}

export interface RecordedActivation {
  domainId: string;
  businessId: string;
  provider: string;
}

export class MemoryCustomDomainStore implements CustomDomainStore {
  private readonly rows = new Map<string, MemoryDomainRow>();
  readonly activations: RecordedActivation[] = [];
  /** Set to make recordActivation throw, modelling a degraded analytics pipeline. */
  activationWritesFail = false;

  seed(row: MemoryDomainRow): void {
    this.rows.set(row.id, row);
  }

  row(domainId: string): MemoryDomainRow | undefined {
    return this.rows.get(domainId);
  }

  listPollable(limit: number): Promise<PendingCustomDomain[]> {
    const pollable = [...this.rows.values()]
      .filter(
        (row): row is MemoryDomainRow & { status: PollableDomainStatus } =>
          row.status === 'PENDING_DNS' || row.status === 'PENDING_SSL',
      )
      .sort((a, b) => (a.lastCheckedAt?.getTime() ?? 0) - (b.lastCheckedAt?.getTime() ?? 0))
      .slice(0, limit);

    return Promise.resolve(
      pollable.map((row) => ({
        id: row.id,
        businessId: row.businessId,
        hostname: row.hostname,
        status: row.status,
        providerHostnameId: row.providerHostnameId,
        activatedAt: row.activatedAt,
      })),
    );
  }

  applyStatus(domainId: string, patch: DomainStatusPatch): Promise<void> {
    const row = this.rows.get(domainId);
    if (!row) return Promise.reject(new Error(`No such domain: ${domainId}`));

    if (patch.status !== undefined) row.status = patch.status;
    if (patch.sslStatus !== undefined) row.sslStatus = patch.sslStatus;
    if (patch.providerHostnameId !== undefined) row.providerHostnameId = patch.providerHostnameId;
    if (patch.errorMessage !== undefined) row.errorMessage = patch.errorMessage;
    if (patch.activatedAt !== undefined) row.activatedAt = patch.activatedAt;
    row.lastCheckedAt = patch.checkedAt;

    return Promise.resolve();
  }

  recordActivation(domain: PendingCustomDomain, providerName: string): Promise<void> {
    if (this.activationWritesFail) {
      return Promise.reject(new Error('analytics write failed'));
    }
    this.activations.push({
      domainId: domain.id,
      businessId: domain.businessId,
      provider: providerName,
    });
    return Promise.resolve();
  }
}

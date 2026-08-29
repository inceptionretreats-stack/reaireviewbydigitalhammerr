/**
 * Custom-domain provider port (ADR-009, D-024, DOM-01).
 *
 * 02_System_Architecture.md names Cloudflare for SaaS as the custom-hostname provider, but the
 * adapter is E11 work. What exists now is the boundary: the polling job talks only to this
 * interface, so the Cloudflare implementation lands as one new file and a wiring change rather
 * than as a rewrite of the job.
 *
 * The port is deliberately shaped around what `custom_domains` stores rather than around any
 * one vendor's API, because ADR-009's whole point is that the vendor is replaceable — the
 * spec's own note is that "the exact managed vendors may change, but service boundaries and
 * contracts should not".
 */

/** Mirrors the domain_status enum, minus the states the platform owns rather than observes. */
export type ObservedDomainState = 'PENDING_DNS' | 'PENDING_SSL' | 'ACTIVE' | 'ERROR';

export interface DomainVerificationRecord {
  type: string;
  name: string;
  value: string;
}

export interface DomainStatusQuery {
  hostname: string;
  /** custom_domains.provider_hostname_id; null before the hostname has been registered. */
  providerHostnameId: string | null;
}

export interface DomainStatusResult {
  state: ObservedDomainState;
  /** Free-form provider vocabulary, stored verbatim in custom_domains.ssl_status. */
  sslStatus: string | null;
  dnsTarget: string | null;
  verificationRecords: DomainVerificationRecord[];
  providerHostnameId: string | null;
  /**
   * Owner-facing explanation for an ERROR state. Never a raw provider error
   * (02_System_Architecture.md security boundaries); the adapter is responsible for
   * translating, and the column caps it at 500 characters.
   */
  errorMessage: string | null;
}

export interface CustomDomainProviderPort {
  /** Identifies the adapter; written to custom_domains.provider. */
  readonly name: string;
  checkStatus(query: DomainStatusQuery): Promise<DomainStatusResult>;
}

export class DomainProviderUnavailableError extends Error {
  constructor(providerName: string, cause?: unknown) {
    super(`Custom-domain provider ${providerName} is unavailable`);
    this.name = 'DomainProviderUnavailableError';
    this.cause = cause;
  }
}

/**
 * The V1 default until E11 ships the Cloudflare adapter.
 *
 * It reports every hostname as unavailable rather than as PENDING or ERROR. Reporting PENDING
 * would be a lie the dashboard renders as progress; reporting ERROR would tell owners their
 * DNS is wrong when nothing has been checked. Unavailable is the truth, and the job records it
 * as "polled, unchanged" — which is also exactly how a real provider outage behaves, so the
 * path gets exercised before the adapter exists.
 */
export class UnconfiguredCustomDomainProvider implements CustomDomainProviderPort {
  readonly name = 'UNCONFIGURED';

  checkStatus(): Promise<DomainStatusResult> {
    return Promise.reject(
      new DomainProviderUnavailableError(
        this.name,
        new Error('No custom-domain provider is configured; the Cloudflare adapter is E11 work'),
      ),
    );
  }
}

/** Scripted provider for tests. */
export class MemoryCustomDomainProvider implements CustomDomainProviderPort {
  readonly name = 'MEMORY';

  private readonly results = new Map<string, DomainStatusResult>();
  private readonly failures = new Set<string>();
  readonly queried: string[] = [];

  respondWith(
    hostname: string,
    result: Partial<DomainStatusResult> & { state: ObservedDomainState },
  ): void {
    this.results.set(hostname, {
      sslStatus: null,
      dnsTarget: null,
      verificationRecords: [],
      providerHostnameId: null,
      errorMessage: null,
      ...result,
    });
  }

  failFor(hostname: string): void {
    this.failures.add(hostname);
  }

  checkStatus(query: DomainStatusQuery): Promise<DomainStatusResult> {
    this.queried.push(query.hostname);

    if (this.failures.has(query.hostname)) {
      return Promise.reject(new DomainProviderUnavailableError(this.name));
    }

    const result = this.results.get(query.hostname);
    if (!result) {
      return Promise.reject(new Error(`No scripted result for ${query.hostname}`));
    }
    return Promise.resolve(result);
  }
}

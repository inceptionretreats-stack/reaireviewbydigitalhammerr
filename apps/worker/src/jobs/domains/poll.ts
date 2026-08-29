import { JOB_NAMES } from '../../queue/names';
import { JobAbortedError, type JobContext, type JobHandler, type JobSummary } from '../types';
import type { CustomDomainProviderPort, DomainStatusResult } from './provider';
import type { CustomDomainStore, DomainStatusPatch, PendingCustomDomain } from './store';

/**
 * Custom-domain status polling (DOM-01, ADR-009, D-024).
 *
 * A stub in the sense that no provider is implemented yet — the Cloudflare adapter is E11 —
 * but the state machine and its guarantees are real, and the injected port is the only thing
 * E11 has to supply.
 *
 * The rule this job exists to keep: local state changes only on a positive observation. If a
 * custom domain fails, "the canonical Digital Hammerr URL remains usable"
 * (02_System_Architecture.md), so nothing here can take a business offline.
 */

/** custom_domains.error_message is varchar(500). */
const ERROR_MESSAGE_LIMIT = 500;

export interface DomainPollOptions {
  batchSize: number;
}

export class CustomDomainPollJob implements JobHandler {
  readonly name = JOB_NAMES.customDomainPoll;

  constructor(
    private readonly store: CustomDomainStore,
    private readonly provider: CustomDomainProviderPort,
    private readonly options: DomainPollOptions,
  ) {}

  async run(context: JobContext): Promise<JobSummary> {
    const pending = await this.store.listPollable(this.options.batchSize);

    let activated = 0;
    let advanced = 0;
    let failedChecks = 0;
    let unchanged = 0;

    for (const domain of pending) {
      if (context.signal.aborted) throw new JobAbortedError(this.name);

      let result: DomainStatusResult;
      try {
        result = await this.provider.checkStatus({
          hostname: domain.hostname,
          providerHostnameId: domain.providerHostnameId,
        });
      } catch (error) {
        failedChecks += 1;
        // Deliberately NOT moved to ERROR. ERROR is an owner-facing verdict on the owner's DNS
        // or certificate, and a provider outage is neither — flipping the row would tell a
        // business its domain is broken because our vendor was down, and DOM-01's remediation
        // text would then be wrong. Record only that a check was attempted.
        await this.store.applyStatus(domain.id, { checkedAt: context.now });
        context.logger.warn('custom-domain provider check failed', {
          domainId: domain.id,
          businessId: domain.businessId,
          provider: this.provider.name,
          errorMessage: error instanceof Error ? error.message : String(error),
        });
        continue;
      }

      const patch = this.buildPatch(domain, result, context.now);
      await this.store.applyStatus(domain.id, patch);

      if (result.state === 'ACTIVE' && domain.activatedAt === null) {
        activated += 1;
        await this.recordActivation(context, domain);
        context.logger.info('custom domain activated', {
          domainId: domain.id,
          businessId: domain.businessId,
          provider: this.provider.name,
        });
      } else if (result.state !== domain.status) {
        advanced += 1;
      } else {
        unchanged += 1;
      }
    }

    return {
      provider: this.provider.name,
      examined: pending.length,
      activated,
      advanced,
      unchanged,
      failedChecks,
    };
  }

  private buildPatch(
    domain: PendingCustomDomain,
    result: DomainStatusResult,
    now: Date,
  ): DomainStatusPatch {
    return {
      status: result.state,
      sslStatus: result.sslStatus,
      dnsTarget: result.dnsTarget,
      verificationRecords: result.verificationRecords,
      providerHostnameId: result.providerHostnameId ?? domain.providerHostnameId,
      errorMessage:
        result.state === 'ERROR'
          ? (result.errorMessage?.slice(0, ERROR_MESSAGE_LIMIT) ?? null)
          : null,
      // Only on the first activation; the store does not second-guess this.
      ...(result.state === 'ACTIVE' && domain.activatedAt === null ? { activatedAt: now } : {}),
      checkedAt: now,
    };
  }

  /**
   * AC-035's principle applied outside the customer flow: the analytics write is best-effort,
   * because a degraded event pipeline must not undo an activation that has already happened
   * and is already stored.
   */
  private async recordActivation(context: JobContext, domain: PendingCustomDomain): Promise<void> {
    try {
      await this.store.recordActivation(domain, this.provider.name);
    } catch (error) {
      context.logger.warn('custom_domain_activated event not recorded', {
        domainId: domain.id,
        businessId: domain.businessId,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

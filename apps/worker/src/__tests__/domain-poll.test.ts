import { describe, expect, it } from 'vitest';
import { CustomDomainPollJob } from '../jobs/domains/poll';
import { MemoryCustomDomainStore, type MemoryDomainRow } from '../jobs/domains/memory-store';
import { MemoryCustomDomainProvider } from '../jobs/domains/provider';
import { harness } from './support/harness';

const NOW = '2026-08-29T12:00:00.000Z';
const ACTIVATED_EARLIER = new Date('2026-08-01T09:00:00.000Z');

function row(
  overrides: Partial<MemoryDomainRow> & { id: string; hostname: string },
): MemoryDomainRow {
  return {
    businessId: 'business-1',
    status: 'PENDING_DNS',
    providerHostnameId: null,
    activatedAt: null,
    lastCheckedAt: null,
    sslStatus: null,
    errorMessage: null,
    ...overrides,
  };
}

function setup() {
  const store = new MemoryCustomDomainStore();
  const provider = new MemoryCustomDomainProvider();

  store.seed(row({ id: 'd1', hostname: 'review.alpha.example' }));
  store.seed(
    row({
      id: 'd2',
      hostname: 'review.beta.example',
      status: 'PENDING_SSL',
      // Flapped back to PENDING_SSL after a previous activation.
      activatedAt: ACTIVATED_EARLIER,
      lastCheckedAt: new Date('2026-08-29T11:00:00.000Z'),
    }),
  );
  store.seed(row({ id: 'd3', hostname: 'review.gamma.example', status: 'ACTIVE' }));
  store.seed(row({ id: 'd4', hostname: 'review.delta.example', status: 'REMOVED' }));
  store.seed(row({ id: 'd5', hostname: 'review.epsilon.example' }));

  provider.respondWith('review.alpha.example', { state: 'ACTIVE', sslStatus: 'active' });
  provider.respondWith('review.beta.example', { state: 'ACTIVE', sslStatus: 'active' });
  provider.respondWith('review.epsilon.example', { state: 'PENDING_DNS' });

  const job = new CustomDomainPollJob(store, provider, { batchSize: 50 });
  return { store, provider, job };
}

describe('custom domain polling', () => {
  it('polls only PENDING_DNS and PENDING_SSL hostnames', async () => {
    const { provider, job } = setup();
    await job.run(harness(NOW).context);

    // ACTIVE is terminal for this job, and a REMOVED row is a hostname the tenant released —
    // AMENDMENT-011 keeps the row so it stays re-claimable, so polling it would resurrect it.
    expect(provider.queried.sort()).toEqual([
      'review.alpha.example',
      'review.beta.example',
      'review.epsilon.example',
    ]);
  });

  it('activates a hostname and records the System event', async () => {
    const { store, job } = setup();
    const summary = await job.run(harness(NOW).context);

    expect(store.row('d1')).toMatchObject({
      status: 'ACTIVE',
      sslStatus: 'active',
      activatedAt: new Date(NOW),
      lastCheckedAt: new Date(NOW),
    });
    expect(store.activations).toEqual([
      { domainId: 'd1', businessId: 'business-1', provider: 'MEMORY' },
    ]);
    expect(summary).toMatchObject({
      examined: 3,
      activated: 1,
      advanced: 1,
      unchanged: 1,
      failedChecks: 0,
    });
  });

  it('does not re-activate a hostname that has activated before', async () => {
    const { store, job } = setup();
    await job.run(harness(NOW).context);

    // activated_at is the first activation; a hostname that flapped and recovered has not
    // been activated twice, and the analytics event must not fire again either.
    expect(store.row('d2')?.status).toBe('ACTIVE');
    expect(store.row('d2')?.activatedAt).toEqual(ACTIVATED_EARLIER);
    expect(store.activations.map((activation) => activation.domainId)).not.toContain('d2');
  });

  /**
   * A provider outage is not a verdict on the tenant's DNS. Flipping the row to ERROR would
   * tell a business its domain is broken because our vendor was down, and
   * 02_System_Architecture.md requires the canonical URL to keep working regardless.
   */
  it('records a failed check without moving the domain to ERROR', async () => {
    const { store, provider, job } = setup();
    provider.failFor('review.epsilon.example');
    const test = harness(NOW);

    const summary = await job.run(test.context);

    expect(store.row('d5')).toMatchObject({
      status: 'PENDING_DNS',
      errorMessage: null,
      lastCheckedAt: new Date(NOW),
    });
    expect(summary.failedChecks).toBe(1);
    expect(test.sink.messages('warn')).toContain('custom-domain provider check failed');
  });

  it('stores an ERROR verdict truncated to the column width', async () => {
    const { store, provider, job } = setup();
    provider.respondWith('review.epsilon.example', {
      state: 'ERROR',
      errorMessage: 'x'.repeat(900),
    });

    await job.run(harness(NOW).context);

    expect(store.row('d5')?.status).toBe('ERROR');
    expect(store.row('d5')?.errorMessage).toHaveLength(500);
  });

  it('counts a hostname that has not moved as unchanged', async () => {
    const { store, provider, job } = setup();
    provider.respondWith('review.epsilon.example', { state: 'PENDING_DNS' });

    const summary = await job.run(harness(NOW).context);

    expect(summary.unchanged).toBe(1);
    expect(store.row('d5')?.status).toBe('PENDING_DNS');
  });

  /** AC-035's principle: a degraded event pipeline must not undo an activation already stored. */
  it('keeps the activation when the analytics write fails', async () => {
    const { store, job } = setup();
    store.activationWritesFail = true;
    const test = harness(NOW);

    const summary = await job.run(test.context);

    expect(store.row('d1')?.status).toBe('ACTIVE');
    expect(summary.activated).toBe(1);
    expect(test.sink.messages('warn')).toContain('custom_domain_activated event not recorded');
  });
});

import type { Entitlement, QuotaOutcome, QuotaReservation, QuotaStore } from './types';

/**
 * Reserve -> call provider -> commit or release.
 *
 * The reservation is taken *before* the provider call so that concurrent requests contend on
 * the database rather than on wall-clock luck, and released if the provider fails. Reserving
 * afterwards would let N concurrent requests all pass a limit check and then all succeed.
 */
export class QuotaService {
  constructor(private readonly store: QuotaStore) {}

  async reserve(businessId: string): Promise<QuotaOutcome> {
    const entitlement = await this.store.getEntitlement(businessId);

    if (!entitlement) {
      return {
        ok: false,
        reason: 'BUSINESS_NOT_ACTIVE',
        entitlement: emptyEntitlement(),
      };
    }

    if (entitlement.mode === 'BLOCKED') {
      return { ok: false, reason: 'SUBSCRIPTION_NOT_ACTIVE', entitlement };
    }

    const consumption = await this.store.tryConsume(businessId, entitlement.mode);
    if (consumption === null) {
      return { ok: false, reason: 'PLAN_QUOTA_EXHAUSTED', entitlement };
    }

    return {
      ok: true,
      reservation: {
        businessId,
        mode: entitlement.mode,
        periodStartsAt: consumption.periodStartsAt,
        counted: true,
        usedAfterReserve: consumption.usedAfterReserve,
      },
    };
  }

  /**
   * Called when a usable draft was returned. The increment already happened at reserve time,
   * so this is a no-op by design — it exists so call sites read as an explicit two-phase
   * commit and cannot silently forget the release path.
   */
  async commit(_reservation: QuotaReservation): Promise<void> {
    return Promise.resolve();
  }

  /** AC-014: the provider failed, so the customer must not lose a generation. */
  async release(reservation: QuotaReservation): Promise<void> {
    if (!reservation.counted) return;
    await this.store.release(reservation);
  }

  /**
   * Runs an operation against a reservation, releasing it if the operation throws or returns
   * no usable draft. Call sites should prefer this over manual commit/release.
   *
   * An internal quality-gate retry belongs *inside* `operation`, so two provider calls still
   * consume exactly one customer generation.
   */
  async withReservation<T>(
    businessId: string,
    operation: (reservation: QuotaReservation) => Promise<T>,
  ): Promise<{ ok: true; result: T } | { ok: false; reason: string; entitlement: Entitlement }> {
    const outcome = await this.reserve(businessId);
    if (!outcome.ok) {
      return { ok: false, reason: outcome.reason, entitlement: outcome.entitlement };
    }

    try {
      const result = await operation(outcome.reservation);
      await this.commit(outcome.reservation);
      return { ok: true, result };
    } catch (error) {
      await this.release(outcome.reservation);
      throw error;
    }
  }
}

function emptyEntitlement(): Entitlement {
  return {
    mode: 'BLOCKED',
    freeGenerationsUsed: 0,
    freeGenerationLimit: 0,
    proGenerationsUsed: 0,
    proGenerationLimit: 0,
    periodStartsAt: null,
    periodEndsAt: null,
    fairUseMonthlySoftLimit: null,
  };
}

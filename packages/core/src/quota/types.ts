/**
 * Free-quota accounting (AC-013, AC-014, D-004, Flow E).
 *
 * The rules this has to satisfy, gathered from across the pack because no single document
 * states them together:
 *
 *  - A Free business gets exactly 10 successful public generations. A concurrent 11th must
 *    not slip through (AC-013).
 *  - A provider failure consumes nothing (AC-014).
 *  - A customer regeneration DOES consume, because it consumes provider resources
 *    (09_AI_Prompt_and_Generation_Spec.md, Flow D step 7).
 *  - An internal quality-gate retry counts as ONE customer generation, not two, even though
 *    it costs two provider calls. Provider cost is tracked separately.
 *  - A business test preview consumes nothing (AI-01-01, ONB-04-02).
 *  - Pro is fair-use unlimited: no counter, soft alerting only, and no hidden hard cap
 *    advertised to normal users (D-006).
 */

export type EntitlementMode = 'FREE' | 'PRO' | 'BLOCKED';

export interface Entitlement {
  mode: EntitlementMode;
  freeGenerationsUsed: number;
  freeGenerationLimit: number;
  /** Soft threshold for Pro fair-use alerting. Never enforced as a hard cap. */
  fairUseMonthlySoftLimit: number | null;
}

export type QuotaDenial =
  'PLAN_QUOTA_EXHAUSTED' | 'SUBSCRIPTION_NOT_ACTIVE' | 'BUSINESS_NOT_ACTIVE';

/**
 * A held reservation. Exactly one of commit() or release() must be called.
 *
 * `counted` distinguishes a Free reservation that incremented the counter from a Pro one that
 * did not, which is what ai_generations.counted_toward_quota records.
 */
export interface QuotaReservation {
  businessId: string;
  mode: 'FREE' | 'PRO';
  counted: boolean;
  usedAfterReserve: number;
}

export type QuotaOutcome =
  | { ok: true; reservation: QuotaReservation }
  | { ok: false; reason: QuotaDenial; entitlement: Entitlement };

/**
 * Storage contract for quota consumption.
 *
 * tryConsume MUST be a single atomic statement, not a read followed by a write. The whole of
 * AC-013 rests on that: with a read-modify-write, ten concurrent requests all read 9 and all
 * write 10, and the business gets nineteen free generations.
 */
export interface QuotaStore {
  getEntitlement(businessId: string): Promise<Entitlement | null>;

  /**
   * Atomically increments usage if and only if it is below the limit.
   * Resolves to the new count, or null when the limit is already reached.
   */
  tryConsume(businessId: string): Promise<number | null>;

  /** Compensating decrement, used when the provider call fails (AC-014). */
  release(businessId: string): Promise<void>;
}

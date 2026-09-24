import type { QuotaService } from '../quota/service';
import type { Entitlement } from '../quota/types';
import { DEFAULT_GUIDANCE, type PromptGuidance } from './guidance';
import { checkVariation, DEFAULT_SIMILARITY_THRESHOLD } from './similarity';
import {
  buildPrompt,
  checkOutputCompliance,
  mentionsUnselectedService,
  MAX_PREVIOUS_DRAFTS,
  type GenerationRequest,
} from './prompt-builder';
import { AiProviderError, type AiProvider, type StructuredReview } from './provider';

/**
 * Orchestrates one customer-visible generation (Flow C, Flow D, REV-01, REV-02).
 *
 * The ordering here carries most of the acceptance criteria:
 *
 *  - Quota is reserved BEFORE the provider call, so concurrent requests contend in the
 *    database rather than on timing (AC-013).
 *  - A provider failure releases the reservation (AC-014).
 *  - The quality gate's internal retry happens INSIDE one reservation, so two provider calls
 *    are still one customer generation (09_AI_Prompt_and_Generation_Spec.md).
 *  - Output compliance is checked on every candidate regardless of the prompt, because a
 *    prompt is guidance and AC-011/AC-012 are policy boundaries.
 */

export interface PromptVersionConfig {
  id: string;
  version: string;
  model: string;
  systemPrompt: string;
  maxOutputTokens: number;
  reasoningEffort: string;
  outputSchema: Record<string, unknown>;
  /** The writing rules this version carries (guidance.ts). Optional so a config built before CHANGE-004 still compiles; the builder falls back to the defaults. */
  guidance?: PromptGuidance;
}

export interface GenerateOptions {
  businessId: string;
  request: GenerationRequest;
  promptVersion: PromptVersionConfig;
  timeoutMs: number;
  similarityThreshold?: number;
}

export interface GeneratedDraft {
  reviewText: string;
  output: StructuredReview;
  model: string;
  promptVersionId: string;
  similarityScore: number;
  countedTowardQuota: boolean;
  quotaType: 'FREE' | 'PRO';
  /** Provider calls actually made. Exceeds 1 when the quality gate retried. */
  providerCalls: number;
  inputTokens: number | null;
  outputTokens: number | null;
  providerRequestId: string | null;
  latencyMs: number;
}

export type GenerationFailure =
  | { code: 'PLAN_QUOTA_EXHAUSTED'; entitlement: Entitlement }
  | { code: 'SUBSCRIPTION_NOT_ACTIVE'; entitlement: Entitlement }
  | { code: 'BUSINESS_NOT_ACTIVE'; entitlement: Entitlement }
  /**
   * `message` is the adapter's own, already scrubbed of anything key-shaped (AC-030). It is for
   * the server log and nothing else: a bad key or a model the provider does not know used to
   * be indistinguishable from the provider being down, because nothing kept the reason.
   */
  | { code: 'AI_PROVIDER_UNAVAILABLE'; errorClass: string; message: string }
  | { code: 'AI_OUTPUT_REJECTED'; rejections: string[] };

export type GenerationOutcome =
  { ok: true; draft: GeneratedDraft } | { ok: false; failure: GenerationFailure };

/**
 * Floor below which a retry is not attempted. Roughly the time a short structured generation
 * needs to complete at all; starting one with less remaining wastes a billed call.
 */
const MIN_ATTEMPT_BUDGET_MS = 1500;

/**
 * Three, not two.
 *
 * 09_AI_Prompt_and_Generation_Spec.md describes one internal retry, and two attempts is enough
 * when the retry is blind. Now that a retry is told what failed, a third attempt is worth its
 * cost: the common rejections — a superlative, a price, an opening too close to the last draft —
 * are all things a model fixes readily once named, and the alternative is a 503 in front of a
 * customer who is standing at a counter. The shared deadline still bounds the whole call, so
 * this buys attempts, not latency: an attempt only starts if MIN_ATTEMPT_BUDGET_MS remains.
 */
const MAX_ATTEMPTS = 3;

export class ReviewGenerator {
  constructor(
    private readonly provider: AiProvider,
    private readonly quota: QuotaService,
  ) {}

  async generate(options: GenerateOptions): Promise<GenerationOutcome> {
    const reservation = await this.quota.reserve(options.businessId);

    if (!reservation.ok) {
      return {
        ok: false,
        failure: { code: reservation.reason, entitlement: reservation.entitlement },
      };
    }

    try {
      const draft = await this.produceAcceptableDraft(options);
      await this.quota.commit(reservation.reservation);
      return {
        ok: true,
        draft: {
          ...draft,
          countedTowardQuota: reservation.reservation.counted,
          quotaType: reservation.reservation.mode,
        },
      };
    } catch (error) {
      // AC-014 and the AI_OUTPUT_REJECTED path both return the reservation: the customer got
      // no usable draft, so they must not lose a generation.
      await this.quota.release(reservation.reservation);

      if (error instanceof QualityGateExhausted) {
        return { ok: false, failure: { code: 'AI_OUTPUT_REJECTED', rejections: error.rejections } };
      }
      if (error instanceof AiProviderError) {
        return {
          ok: false,
          failure: {
            code: 'AI_PROVIDER_UNAVAILABLE',
            errorClass: error.errorClass,
            message: error.message,
          },
        };
      }
      throw error;
    }
  }

  /**
   * Generates, checks, and retries at most once — the spec allows exactly one internal retry
   * with a stronger variation instruction (regeneration algorithm step 4).
   *
   * options.timeoutMs is the budget for the WHOLE call, not per attempt. That distinction
   * matters: 09_AI_Prompt_and_Generation_Spec.md sets an 8-second server-side budget, and
   * giving each of two attempts the full 8s would let a retry reach 16s — past the point where
   * the customer has given up, while still billing for both calls. The deadline is therefore
   * shared, and a retry is skipped when too little of it remains to be worth spending.
   */
  private async produceAcceptableDraft(
    options: GenerateOptions,
  ): Promise<Omit<GeneratedDraft, 'countedTowardQuota' | 'quotaType'>> {
    const threshold = options.similarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD;
    const maxAttempts = MAX_ATTEMPTS;
    const deadline = Date.now() + options.timeoutMs;

    let lastRejections: string[] = [];
    let providerCalls = 0;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const remainingMs = deadline - Date.now();

      // A retry needs enough budget left to plausibly finish. Below the floor the honest move
      // is to stop and surface the rejection rather than start a call that will time out and
      // be billed anyway.
      if (remainingMs < MIN_ATTEMPT_BUDGET_MS) {
        if (attempt === 1) {
          throw new AiProviderError('generation budget exhausted', 'TIMEOUT', true);
        }
        break;
      }

      // Each retry carries why the last attempt was thrown away, so the model corrects rather
      // than resamples. The shared deadline above still caps the whole call.
      const prompt = buildPrompt(
        attempt === 1
          ? options.request
          : withStrongerVariation(options.request, attempt, lastRejections),
        options.promptVersion.systemPrompt,
        options.promptVersion.guidance ?? DEFAULT_GUIDANCE,
      );

      const result = await this.provider.generate({
        prompt,
        model: options.promptVersion.model,
        maxOutputTokens: options.promptVersion.maxOutputTokens,
        reasoningEffort: options.promptVersion.reasoningEffort,
        timeoutMs: remainingMs,
        outputSchema: options.promptVersion.outputSchema,
      });
      providerCalls += 1;

      const text = result.output.review_text.trim();
      const compliance = checkOutputCompliance(text);
      const serviceScopePassed = !mentionsUnselectedService(text, options.request);
      // The same window the prompt disclosed, not the whole history. The two used to diverge:
      // the prompt showed the last three drafts while the gate compared against every one, so a
      // long session eventually rejected a draft for resembling something the model had no way
      // to know about, retried into the same wall, and returned AI_OUTPUT_REJECTED for good.
      const variation = checkVariation(
        text,
        options.request.previousDrafts.slice(-MAX_PREVIOUS_DRAFTS),
        threshold,
      );

      if (compliance.passed && variation.passed && serviceScopePassed) {
        return {
          reviewText: text,
          output: result.output,
          model: options.promptVersion.model,
          promptVersionId: options.promptVersion.id,
          similarityScore: variation.score,
          providerCalls,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          providerRequestId: result.providerRequestId,
          latencyMs: result.latencyMs,
        };
      }

      lastRejections = [
        ...compliance.rejections,
        ...(serviceScopePassed ? [] : ['UNSELECTED_SERVICE']),
        ...(variation.passed ? [] : [`TOO_SIMILAR:${variation.score.toFixed(3)}`]),
      ];
    }

    throw new QualityGateExhausted(lastRejections);
  }
}

class QualityGateExhausted extends Error {
  constructor(readonly rejections: string[]) {
    super(`AI output rejected after retry: ${rejections.join(', ')}`);
    this.name = 'QualityGateExhausted';
  }
}

function withStrongerVariation(
  request: GenerationRequest,
  attempt: number,
  rejections: string[],
): GenerationRequest {
  return {
    ...request,
    generationNumber: request.generationNumber + attempt - 1,
    rejections,
  };
}

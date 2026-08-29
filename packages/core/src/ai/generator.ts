import type { QuotaService } from '../quota/service';
import type { Entitlement } from '../quota/types';
import { checkVariation, DEFAULT_SIMILARITY_THRESHOLD } from './similarity';
import { buildPrompt, checkOutputCompliance, type GenerationRequest } from './prompt-builder';
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
  | { code: 'AI_PROVIDER_UNAVAILABLE'; errorClass: string }
  | { code: 'AI_OUTPUT_REJECTED'; rejections: string[] };

export type GenerationOutcome =
  { ok: true; draft: GeneratedDraft } | { ok: false; failure: GenerationFailure };

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
        draft: { ...draft, countedTowardQuota: reservation.reservation.counted },
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
          failure: { code: 'AI_PROVIDER_UNAVAILABLE', errorClass: error.errorClass },
        };
      }
      throw error;
    }
  }

  /**
   * Generates, checks, and retries at most once — the spec allows exactly one internal retry
   * with a stronger variation instruction (regeneration algorithm step 4).
   */
  private async produceAcceptableDraft(
    options: GenerateOptions,
  ): Promise<Omit<GeneratedDraft, 'countedTowardQuota'>> {
    const threshold = options.similarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD;
    const maxAttempts = 2;

    let lastRejections: string[] = [];
    let providerCalls = 0;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const prompt = buildPrompt(
        attempt === 1 ? options.request : withStrongerVariation(options.request),
        options.promptVersion.systemPrompt,
      );

      const result = await this.provider.generate({
        prompt,
        model: options.promptVersion.model,
        maxOutputTokens: options.promptVersion.maxOutputTokens,
        reasoningEffort: options.promptVersion.reasoningEffort,
        timeoutMs: options.timeoutMs,
        outputSchema: options.promptVersion.outputSchema,
      });
      providerCalls += 1;

      const text = result.output.review_text.trim();
      const compliance = checkOutputCompliance(text);
      const variation = checkVariation(text, options.request.previousDrafts, threshold);

      if (compliance.passed && variation.passed) {
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

function withStrongerVariation(request: GenerationRequest): GenerationRequest {
  return { ...request, generationNumber: request.generationNumber + 1 };
}

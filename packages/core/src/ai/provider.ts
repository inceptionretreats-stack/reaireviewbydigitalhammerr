import type { BuiltPrompt } from './prompt-builder';

/**
 * Provider adapter (E4-04, ADR-006, ADR-007).
 *
 * Deliberately thin, for two reasons. The model id is admin data in ai_prompt_versions rather
 * than source, so quality can be rolled back without a deploy (ADMIN-03-03). And the AI line
 * is the dominant variable cost of the business — roughly 4.6% of revenue on Luna against
 * ~45% on Terra — so being able to change provider or model by configuration is a commercial
 * control, not just an architectural nicety.
 */

export interface GenerationParams {
  prompt: BuiltPrompt;
  model: string;
  maxOutputTokens: number;
  reasoningEffort: string;
  timeoutMs: number;
  outputSchema: Record<string, unknown>;
}

/** Matches the strict output schema in 10_AI_Prompt_Templates.json. */
export interface StructuredReview {
  review_text: string;
  used_context_terms: string[];
  claim_risk: 'low' | 'medium' | 'high';
  /** Never shown to the customer (09_AI_Prompt_and_Generation_Spec.md). */
  internal_quality_notes: string[];
}

export interface GenerationResult {
  output: StructuredReview;
  inputTokens: number | null;
  outputTokens: number | null;
  providerRequestId: string | null;
  latencyMs: number;
}

export class AiProviderError extends Error {
  constructor(
    message: string,
    readonly errorClass: 'TIMEOUT' | 'RATE_LIMITED' | 'INVALID_OUTPUT' | 'UPSTREAM',
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'AiProviderError';
  }
}

export interface AiProvider {
  readonly name: string;
  generate(params: GenerationParams): Promise<GenerationResult>;
}

/**
 * Deterministic stub used by CI and local development.
 *
 * Every automated test in the pack's required suites — the quota boundary, the confirmation
 * gate, the funnel — needs generation to work without reaching a paid provider. Making the
 * output deterministic also lets the regeneration gate be tested for real: `variant` changes
 * the draft enough to cross the similarity threshold.
 */
export class StubAiProvider implements AiProvider {
  readonly name = 'stub';
  private callCount = 0;

  constructor(private readonly behaviour: 'ok' | 'fail' | 'repetitive' = 'ok') {}

  get calls(): number {
    return this.callCount;
  }

  generate(_params: GenerationParams): Promise<GenerationResult> {
    this.callCount += 1;

    if (this.behaviour === 'fail') {
      return Promise.reject(new AiProviderError('stub failure', 'UPSTREAM', true));
    }

    // 'repetitive' always returns the same text, so the variation gate should reject it.
    const variant = this.behaviour === 'repetitive' ? 0 : this.callCount;

    return Promise.resolve({
      output: {
        review_text: stubDraft(variant),
        used_context_terms: [],
        claim_risk: 'low',
        internal_quality_notes: [],
      },
      inputTokens: 420,
      outputTokens: 96,
      providerRequestId: `stub-${this.callCount}`,
      latencyMs: 5,
    });
  }
}

const STUB_DRAFTS = [
  'Visited recently and found the whole thing straightforward. Staff were helpful when I had a question, and I would happily come back another time.',
  'Dropped by this week without an appointment. Everything moved along at a comfortable pace and I left satisfied with how the visit went overall.',
  'Called in during the afternoon. The place was tidy, the people there answered what I asked, and nothing about the visit felt like a hassle.',
  'Been meaning to write about my visit here. It was an easy experience from start to finish and I have no complaints worth mentioning at all.',
];

function stubDraft(variant: number): string {
  return STUB_DRAFTS[variant % STUB_DRAFTS.length]!;
}

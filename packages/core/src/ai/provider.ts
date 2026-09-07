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
 * gate, the funnel — needs generation to work without reaching a paid provider.
 *
 * Selection is derived from `params`, never from instance state. It used to come from a call
 * counter, which was correct in a unit test holding one provider for a whole scenario and wrong
 * everywhere else: the route builds a fresh provider per request, so the counter restarted at 0
 * on every call while the similarity gate compared against drafts that had been *persisted*.
 * The third generation in a session therefore proposed two already-stored drafts, exhausted its
 * attempts and returned AI_OUTPUT_REJECTED — permanently, because the anonymous cookie lives for
 * thirty days. Deriving from the request makes the stub behave the same however it is
 * constructed, which is the only property that made the bug possible to miss.
 */
export class StubAiProvider implements AiProvider {
  readonly name = 'stub';
  private callCount = 0;

  constructor(private readonly behaviour: 'ok' | 'fail' | 'repetitive' = 'ok') {}

  /** Kept for tests that assert how many provider calls a scenario made. */
  get calls(): number {
    return this.callCount;
  }

  generate(params: GenerationParams): Promise<GenerationResult> {
    this.callCount += 1;

    if (this.behaviour === 'fail') {
      return Promise.reject(new AiProviderError('stub failure', 'UPSTREAM', true));
    }

    return Promise.resolve({
      output: {
        review_text: this.draftFor(params),
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

  /**
   * The first draft the prompt has not already seen.
   *
   * buildPrompt embeds PREVIOUS_DRAFTS verbatim, so the prompt itself says which texts would be
   * rejected as too similar — no new interface, and no guessing. A real provider does this by
   * writing something new; the stub does it by choosing something unused, which is the closest
   * honest imitation available to a fixed pool.
   */
  private draftFor(params: GenerationParams): string {
    // 'repetitive' must always return the same text: it exists so the variation gate can be
    // tested for real, and picking a fresh draft would defeat exactly that.
    if (this.behaviour === 'repetitive') return STUB_DRAFTS[0]!;

    const seen = params.prompt.user;
    const unused = STUB_DRAFTS.find((draft) => !seen.includes(draft));
    if (unused) return unused;

    // Pool exhausted — more prior drafts than the pool holds. Fall back to a prompt-derived
    // index so the answer still varies with the request rather than with call order.
    return STUB_DRAFTS[hashToIndex(seen, STUB_DRAFTS.length)]!;
  }
}

/**
 * Eight, not four: the similarity gate compares against the last three drafts and the generator
 * makes up to three attempts, so a pool that small could be exhausted inside one session.
 */
export const STUB_DRAFTS = [
  'Visited recently and found the whole thing straightforward. Staff were helpful when I had a question, and I would happily come back another time.',
  'Dropped by this week without an appointment. Everything moved along at a comfortable pace and I left satisfied with how the visit went overall.',
  'Called in during the afternoon. The place was tidy, the people there answered what I asked, and nothing about the visit felt like a hassle.',
  'Been meaning to write about my visit here. It was an easy experience from start to finish and I have no complaints worth mentioning at all.',
  'Stopped in on a weekday morning and was seen without much of a wait. The people here were patient with my questions and I left knowing what I needed to.',
  'Came here on a recommendation from a neighbour. Everything was explained clearly before anything went ahead, which I appreciated more than I expected to.',
  'A straightforward visit with no surprises. I was told what to expect at the start and that is roughly how it went, which is all I really wanted.',
  'Went in expecting to wait around and did not have to. Simple to deal with, easy to find, and I would not hesitate to come back if I need to.',
];

/** FNV-1a, for a stable index from a string. Not security-sensitive. */
function hashToIndex(value: string, buckets: number): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % buckets;
}

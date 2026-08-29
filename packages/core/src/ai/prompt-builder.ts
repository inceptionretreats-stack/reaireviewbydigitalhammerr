/**
 * Builds the model input from stored business context (09_AI_Prompt_and_Generation_Spec.md).
 *
 * The constraint shaping all of this: V1 asks the customer nothing — no questionnaire (D-008),
 * no star rating (D-009). So the model has no facts about *this* customer's experience, only
 * facts about the business. Everything here is therefore framed as business context, and the
 * prompt's job is to keep the draft low-claim enough that a real customer can honestly confirm
 * it (ADR-008).
 */

export interface BusinessContextInput {
  name: string;
  category: string;
  city?: string | null;
  description?: string | null;
  services: string[];
  contextTerms: string[];
}

export interface ReviewModeInput {
  name: string;
  description?: string | null;
  contextTerms: string[];
}

export interface GenerationRequest {
  business: BusinessContextInput;
  reviewMode?: ReviewModeInput | null;
  previousDrafts: string[];
  generationNumber: number;
}

/** Cap on context passed to the model, keeping input tokens — and cost — predictable. */
const MAX_SERVICES = 30;
const MAX_CONTEXT_TERMS = 30;
const MAX_PREVIOUS_DRAFTS = 3;

export interface BuiltPrompt {
  system: string;
  user: string;
}

/**
 * Merchant terms are *hints*, never requirements (D-025, AC-010).
 *
 * This is the compliance-critical part of the whole feature. If merchant terms were forced
 * into every draft, the output stops being the customer's review and becomes merchant-authored
 * text with a customer's name on it — which is what Google's fake-engagement policy exists to
 * stop. The prompt says "at most two, only where natural", and AC-010 tests it.
 */
export function buildPrompt(request: GenerationRequest, systemPrompt: string): BuiltPrompt {
  const business = {
    name: request.business.name,
    category: request.business.category,
    city: request.business.city ?? undefined,
    description: request.business.description ?? undefined,
    services: request.business.services.slice(0, MAX_SERVICES),
    context_terms: request.business.contextTerms.slice(0, MAX_CONTEXT_TERMS),
  };

  const mode = request.reviewMode
    ? {
        name: request.reviewMode.name,
        description: request.reviewMode.description ?? undefined,
        context_terms: request.reviewMode.contextTerms.slice(0, MAX_CONTEXT_TERMS),
      }
    : null;

  // Only the most recent drafts, per the spec's regeneration algorithm step 1.
  const previousDrafts = request.previousDrafts.slice(-MAX_PREVIOUS_DRAFTS);

  const lines = [
    `BUSINESS=${JSON.stringify(business)}`,
    `ACTIVE_MODE=${JSON.stringify(mode)}`,
    `PREVIOUS_DRAFTS=${JSON.stringify(previousDrafts)}`,
    `GENERATION_NUMBER=${request.generationNumber}`,
    'Generate one low-claim, editable review draft consistent with the rules.',
  ];

  if (previousDrafts.length > 0) {
    lines.push(
      'This is a regeneration. Vary sentence structure and opening substantially; do not restate the previous draft with synonyms.',
    );
  }

  return { system: systemPrompt, user: lines.join('\n') };
}

/**
 * Post-generation compliance checks (AC-011, AC-012, and the guardrails in
 * 13_Security_Privacy_Compliance.md).
 *
 * These run on output regardless of what the prompt asked for, because a prompt is guidance
 * and this is a policy boundary. A draft that fails here is rejected and retried rather than
 * shown.
 */
export type OutputRejection =
  | 'STATES_A_RATING'
  | 'EXTREME_PRAISE'
  | 'MENTIONS_INCENTIVE'
  | 'UNSUPPORTED_SPECIFIC_CLAIM'
  | 'TOO_SHORT'
  | 'TOO_LONG';

const RATING_PATTERNS = [
  /\b(?:five|5|four|4|three|3|two|2|one|1)[\s-]*stars?\b/i,
  /\bstar[\s-]*rating\b/i,
  /\b\d(?:\.\d)?\s*\/\s*5\b/,
  /\brated?\s+(?:it\s+)?\d/i,
];

const INCENTIVE_PATTERNS = [
  /\b(?:discount|coupon|voucher|cashback|free\s+(?:meal|gift|item)|reward)\b/i,
  /\bin\s+(?:exchange|return)\s+for\b/i,
];

/** AC-012: claims the customer never supplied, because V1 never asked them anything. */
const UNSUPPORTED_CLAIM_PATTERNS = [
  /\bwithin\s+\d+\s*(?:minutes?|mins?|hours?|days?)\b/i,
  /\b(?:in|after|took)\s+(?:just\s+|only\s+)?\d+\s*(?:minutes?|mins?|hours?)\b/i,
  // Currency can lead the amount ("saved me Rs 2000") or trail it ("saved me 2000 rupees"),
  // so both orders are matched. Matching only the symbol form left the commonest Indian
  // phrasing undetected.
  /(?:₹|\brs\.?|\binr\b|\$)\s*\d+(?:,\d{3})*/i,
  /\b\d+(?:,\d{3})*\s*(?:rupees?|rs\.?|inr|dollars?|usd)\b/i,
  /\b\d+\s*%\s*(?:off|cheaper|faster|better|less)\b/i,
];

const EXTREME_PRAISE_PATTERNS = [
  /\bbest\s+(?:in|ever|place|service)\b/i,
  /\bperfect\b/i,
  /\bguaranteed?\b/i,
  /\bflawless\b/i,
];

export interface OutputCheck {
  passed: boolean;
  rejections: OutputRejection[];
}

export function checkOutputCompliance(
  text: string,
  { minChars = 80, maxChars = 1200 }: { minChars?: number; maxChars?: number } = {},
): OutputCheck {
  const rejections: OutputRejection[] = [];

  if (text.trim().length < minChars) rejections.push('TOO_SHORT');
  if (text.length > maxChars) rejections.push('TOO_LONG');
  if (RATING_PATTERNS.some((p) => p.test(text))) rejections.push('STATES_A_RATING');
  if (EXTREME_PRAISE_PATTERNS.some((p) => p.test(text))) rejections.push('EXTREME_PRAISE');
  if (INCENTIVE_PATTERNS.some((p) => p.test(text))) rejections.push('MENTIONS_INCENTIVE');
  if (UNSUPPORTED_CLAIM_PATTERNS.some((p) => p.test(text))) {
    rejections.push('UNSUPPORTED_SPECIFIC_CLAIM');
  }

  return { passed: rejections.length === 0, rejections };
}

/** AC-010: merchant terms must not all be forced in. Used to assert, not to rewrite. */
export function countUsedContextTerms(text: string, terms: string[]): number {
  const haystack = text.toLowerCase();
  return terms.filter((term) => haystack.includes(term.toLowerCase())).length;
}

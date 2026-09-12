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

export {
  DEFAULT_DRAFT_LANGUAGE,
  DRAFT_LANGUAGES,
  draftLanguageLine,
  readDraftLanguage,
  type DraftLanguage,
} from './draft-language';
import { draftLanguageLine, type DraftLanguage } from './draft-language';
import { DEFAULT_GUIDANCE, type PromptGuidance } from './guidance';

/**
 * The opening angles and emoji placements now live on the prompt version (guidance.ts); these
 * names stay exported for the tests and the seed that read the defaults.
 */
export const OPENING_HINTS: readonly string[] = DEFAULT_GUIDANCE.opening_hints;
export const EMOJI_PLACEMENTS: readonly string[] = DEFAULT_GUIDANCE.emoji_placements;

/** FNV-1a, for a stable choice from a seed. Not security-sensitive. */
function seedHash(seed: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/**
 * The opening for this generation. Advances with the generation number, so a customer who taps
 * "New review" four times gets four different openings rather than four variations on one —
 * which is what happened when the hint was tied to the session alone. Consecutive generations
 * are guaranteed different hints; the seed decides where the sequence starts.
 */
export function openingHintFor(
  seed: string,
  generationNumber = 1,
  hints: readonly string[] = DEFAULT_GUIDANCE.opening_hints,
): string {
  const start = seedHash(seed) % hints.length;
  return hints[(start + Math.max(0, generationNumber - 1)) % hints.length]!;
}

/** Emoji placement for this generation; a different stride, so it does not track the opening. */
export function emojiPlacementFor(
  seed: string,
  generationNumber = 1,
  placements: readonly string[] = DEFAULT_GUIDANCE.emoji_placements,
): string {
  const start = seedHash(`emoji:${seed}`) % placements.length;
  return placements[(start + 2 * Math.max(0, generationNumber - 1)) % placements.length]!;
}

export interface GenerationRequest {
  business: BusinessContextInput;
  reviewMode?: ReviewModeInput | null;
  previousDrafts: string[];
  generationNumber: number;
  /** Required rather than defaulted, so every caller states it and typecheck finds the ones that do not. */
  draftLanguage: DraftLanguage;
  /**
   * Picks the opening hint. The anonymous session id in the customer flow, a fresh id per owner
   * preview — anything stable for one request and different between customers. Omitted, the
   * hint is omitted too, and the model opens however it likes.
   */
  variationSeed?: string;
  /**
   * Why the previous attempt in *this* request was thrown away, in the vocabulary of
   * OutputRejection.
   *
   * Only set on a retry. Without it a retry is a blind resample: the model is asked the same
   * question and has no idea the last answer named a price or called the place perfect, so it
   * is free to do the same thing again and burn the attempt. Naming the failure is the
   * difference between a second chance and a second coin flip.
   */
  rejections?: string[];
}

/** Cap on context passed to the model, keeping input tokens — and cost — predictable. */
const MAX_SERVICES = 30;
const MAX_CONTEXT_TERMS = 30;
/**
 * How many earlier drafts the prompt discloses, per the spec's regeneration algorithm step 1.
 *
 * Exported because the similarity gate must use the same window. Judging a draft against texts
 * the model was never shown is unwinnable: it cannot avoid what it cannot see, and every attempt
 * burns against a rule it was not told. That mismatch dead-ended the fifth generation of a
 * session outright.
 */
export const MAX_PREVIOUS_DRAFTS = 3;

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
/**
 * What to tell the model when a specific gate rejected the last attempt.
 *
 * Phrased as a correction rather than a prohibition. "Do not mention prices" invites the model
 * to think about prices; "describe what happened, not what it cost" gives it somewhere else to
 * go. Keyed on the rejection code's prefix so TOO_SIMILAR:0.812 matches TOO_SIMILAR.
 */
const REJECTION_GUIDANCE: Record<string, string> = {
  STATES_A_RATING:
    'Do not mention stars, scores or a number out of five. Rating happens on Google.',
  EXTREME_PRAISE:
    'Drop superlatives. Describe what happened in plain words rather than calling it the best or perfect.',
  MENTIONS_INCENTIVE:
    'Say nothing about discounts, free items, offers or anything received in return.',
  UNSUPPORTED_SPECIFIC_CLAIM:
    'Remove specific figures — prices, amounts, percentages and exact durations. Describe the experience, not what it cost or how many minutes it took.',
  TOO_SHORT: 'Write more: aim for 45 to 85 words.',
  TOO_LONG: 'Shorter: aim for 45 to 85 words.',
  TOO_SIMILAR:
    'Open differently and restructure the sentences. Do not paraphrase the previous draft.',
};

export function buildPrompt(
  request: GenerationRequest,
  systemPrompt: string,
  guidance: PromptGuidance = DEFAULT_GUIDANCE,
): BuiltPrompt {
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
    draftLanguageLine(request.draftLanguage),
    'Generate one low-claim, editable review draft consistent with the rules.',
    ...guidance.language_rules[request.draftLanguage],
    ...guidance.claim_rules,
  ];

  lines.push(...guidance.emoji_rules);
  if (request.variationSeed !== undefined) {
    const seed = request.variationSeed;
    const n = request.generationNumber;
    lines.push(
      `OPENING: ${openingHintFor(seed, n, guidance.opening_hints)} Do not begin with the business name and do not begin with "Main" or "I".`,
    );
    if (guidance.emoji_rules.length > 0) {
      lines.push(`EMOJI_PLACEMENT: ${emojiPlacementFor(seed, n, guidance.emoji_placements)}.`);
    }
  }

  if (previousDrafts.length > 0) {
    lines.push(
      'This is a regeneration. Vary sentence structure and opening substantially; do not restate the previous draft with synonyms.',
    );
  }

  const rejections = request.rejections ?? [];
  if (rejections.length > 0) {
    lines.push(
      `The previous attempt was rejected for: ${rejections.join(', ')}. Write a different draft that does not repeat those problems.`,
      ...rejections.flatMap((code) => {
        const guidance = REJECTION_GUIDANCE[code.split(':')[0] ?? ''];
        return guidance ? [`- ${guidance}`] : [];
      }),
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
  // Roman Hindi (CHANGE-003): "paanch star", "5 sitare", "4 ki rating", "star deta hoon".
  /\b(?:paanch|panch|chaar|char|teen|do|ek|\d)[\s-]*(?:sitare|sitaare|sitara|taare|stars?)\b/i,
  /\b\d(?:\.\d)?\s*(?:ki\s+)?rating\b/i,
  /\bstars?\s+(?:deta|deti|dunga|doonga|diye|di)\b/i,
];

const INCENTIVE_PATTERNS = [
  /\b(?:discount|coupon|voucher|cashback|free\s+(?:meal|gift|item)|reward)\b/i,
  /\bin\s+(?:exchange|return)\s+for\b/i,
  // Roman Hindi: "muft mein", "free mein", "ke badle mein", "chhoot".
  /\bmuft\b/i,
  /\bfree\s+(?:mein|me)\b/i,
  /\b(?:ke\s+)?badle\s+(?:mein|me)\b/i,
  /\bchh?oot\b/i,
];

/** AC-012: claims the customer never supplied, because V1 never asked them anything. */
const UNSUPPORTED_CLAIM_PATTERNS = [
  /\bwithin\s+\d+\s*(?:minutes?|mins?|hours?|days?)\b/i,
  /\b(?:in|after|took)\s+(?:just\s+|only\s+)?\d+\s*(?:minutes?|mins?|hours?)\b/i,
  // Currency can lead the amount ("saved me Rs 2000") or trail it ("saved me 2000 rupees"),
  // so both orders are matched. Matching only the symbol form left the commonest Indian
  // phrasing undetected.
  /(?:₹|\brs\.?|\binr\b|\$)\s*\d+(?:,\d{3})*/i,
  /\b\d+(?:,\d{3})*\s*(?:rupees?|rupaye|rupay|rupiya|rupya|rs\.?|inr|dollars?|usd)\b/i,
  /\b\d+\s*%\s*(?:off|cheaper|faster|better|less|sasta|saste|sasti|kam)\b/i,
  // Roman Hindi durations: "10 minute mein", "do ghante ke andar". Spoken Hinglish counts in
  // words as often as digits, so the small number words are matched too.
  /\b(?:\d+|ek|do|teen|chaar|char|paanch|panch|das)\s*(?:minute?s?|mins?|minat|ghante|ghanta|din|hafte)\s*(?:mein|me|ke\s+andar)\b/i,
];

const EXTREME_PRAISE_PATTERNS = [
  /\bbest\s+(?:in|ever|place|service)\b/i,
  /\bperfect\b/i,
  /\bguaranteed?\b/i,
  /\bflawless\b/i,
  // Roman Hindi superlatives. "bahut accha" (very good) is ordinary praise and passes;
  // "sabse accha" (the best) and "behtareen"/"lajawab" (finest, beyond compare) do not.
  /\bsabse\s+(?:best|accha|acha|achha|badhiya|badiya|behtar|behtareen)\b/i,
  /\b(?:behtareen|lajawab)\b/i,
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

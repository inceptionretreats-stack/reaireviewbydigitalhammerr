/**
 * Regeneration variation gate (09_AI_Prompt_and_Generation_Spec.md, AC-009, Flow D).
 *
 * AC-009 requires that a regenerated draft "differs materially from the previous draft and
 * does not simply synonym-swap". Character trigrams catch the synonym-swap case that a
 * word-level comparison misses: swapping "great" for "excellent" leaves most of the sentence
 * structure, and therefore most trigrams, intact.
 */

/**
 * AMENDMENT-014 — calibrated to this metric, not carried over from the spec.
 *
 * 09_AI_Prompt_and_Generation_Spec.md recommends 0.82, but describes it as "normalized
 * semantic/text similarity". 0.82 is a sensible cut for *embedding cosine* similarity; this
 * gate uses character-trigram Jaccard, which is a different scale, and at 0.82 a two-word
 * synonym swap scores 0.702 and sails through — exactly what AC-009 forbids.
 *
 * Measured against a representative 100-character draft:
 *
 *   identical                1.000
 *   punctuation-only change  1.000
 *   clauses reordered        0.968
 *   one word swapped         0.818
 *   two words swapped        0.702
 *   ---------------------------- 0.45 threshold
 *   four words swapped       0.319
 *   different topic          0.112
 *   genuine rewrite          0.070
 *
 * The distribution is strongly bimodal, so the exact cut is not delicate: anything from about
 * 0.35 to 0.65 separates the two clusters. 0.45 sits mid-gap. The calibration table is pinned
 * by test, so changing the metric without re-calibrating will fail CI.
 */
export const DEFAULT_SIMILARITY_THRESHOLD = 0.45;

/** Lowercase, strip punctuation, collapse whitespace — per the spec's normalization step. */
export function normalizeForComparison(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function trigrams(text: string): Set<string> {
  const padded = `  ${text} `;
  const out = new Set<string>();
  for (let i = 0; i < padded.length - 2; i += 1) {
    out.add(padded.slice(i, i + 3));
  }
  return out;
}

/** Jaccard similarity over character trigrams. 1 is identical, 0 shares nothing. */
export function similarity(a: string, b: string): number {
  const left = normalizeForComparison(a);
  const right = normalizeForComparison(b);

  if (left.length === 0 && right.length === 0) return 1;
  if (left.length === 0 || right.length === 0) return 0;
  if (left === right) return 1;

  const setA = trigrams(left);
  const setB = trigrams(right);

  let intersection = 0;
  for (const gram of setA) {
    if (setB.has(gram)) intersection += 1;
  }

  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Highest similarity against any previous draft — the spec compares against the last three. */
export function maxSimilarity(candidate: string, previousDrafts: readonly string[]): number {
  return previousDrafts.reduce((worst, draft) => Math.max(worst, similarity(candidate, draft)), 0);
}

export interface VariationCheck {
  passed: boolean;
  score: number;
  threshold: number;
}

export function checkVariation(
  candidate: string,
  previousDrafts: readonly string[],
  threshold = DEFAULT_SIMILARITY_THRESHOLD,
): VariationCheck {
  const score = maxSimilarity(candidate, previousDrafts);
  return { passed: score <= threshold, score, threshold };
}

import type { StructuredReview } from './provider';

/**
 * One definition of "a valid structured review", shared by every provider adapter.
 *
 * Each adapter asks its provider for the schema in `ai_prompt_versions.output_schema` and each
 * gets back JSON that claims to match it. Validating that claim in one place means a provider
 * cannot become the odd one out — and, more importantly, the object is *rebuilt* field by field
 * rather than spread, so a mis-edited admin schema cannot leak an extra property through to the
 * customer no matter which provider produced it.
 */
export function parseStructuredReview(value: unknown): StructuredReview | null {
  if (!isRecord(value)) return null;

  const reviewText = value['review_text'];
  const usedContextTerms = value['used_context_terms'];
  const claimRisk = value['claim_risk'];
  const notes = value['internal_quality_notes'];

  if (typeof reviewText !== 'string' || reviewText.trim().length === 0) return null;
  if (!isStringArray(usedContextTerms)) return null;
  if (!isClaimRisk(claimRisk)) return null;
  if (!isStringArray(notes)) return null;

  return {
    review_text: reviewText,
    used_context_terms: usedContextTerms,
    claim_risk: claimRisk,
    internal_quality_notes: notes,
  };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isClaimRisk(value: unknown): value is StructuredReview['claim_risk'] {
  return value === 'low' || value === 'medium' || value === 'high';
}

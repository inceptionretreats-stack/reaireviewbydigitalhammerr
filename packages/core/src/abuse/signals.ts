import { checkOutputCompliance } from '../ai/prompt-builder';

/**
 * Abuse signals (19_Admin_Panel_Spec L107-122, AMENDMENT-030), computed on read from numbers
 * the tables already hold. No pipeline, no scoring model: four plain thresholds an admin can
 * reason about, each with the figures that tripped it so the screen can show its working.
 */
export type AbuseSignalKind =
  'generation_spike' | 'repeated_signups' | 'feedback_spam' | 'unsafe_ai_context';

export interface AbuseSignal {
  kind: AbuseSignalKind;
  /** One sentence for the admin. */
  summary: string;
  /** The numbers behind it. */
  evidence: Record<string, number | string>;
}

export interface GenerationSignalInput {
  last24h: number;
  avgPerDay7d: number;
}

/** More than three times the 7-day daily average, and at least 20, in the last 24 hours. */
export function generationSpike(input: GenerationSignalInput): AbuseSignal | null {
  if (input.last24h < 20 || input.last24h <= 3 * input.avgPerDay7d) return null;
  return {
    kind: 'generation_spike',
    summary: `${input.last24h} Ai drafts in 24 hours against a 7-day average of ${input.avgPerDay7d.toFixed(1)} a day.`,
    evidence: { last_24h: input.last24h, avg_per_day_7d: Number(input.avgPerDay7d.toFixed(2)) },
  };
}

/** Three or more accounts created from one hashed address in 24 hours. */
export function repeatedSignups(input: { signups24h: number; ipHash: string }): AbuseSignal | null {
  if (input.signups24h < 3) return null;
  return {
    kind: 'repeated_signups',
    summary: `${input.signups24h} accounts created from the same network address in 24 hours.`,
    evidence: { signups_24h: input.signups24h, ip_hash: input.ipHash.slice(0, 10) },
  };
}

/** Ten or more private feedback submissions for one business in 24 hours. */
export function feedbackSpam(input: { feedback24h: number }): AbuseSignal | null {
  if (input.feedback24h < 10) return null;
  return {
    kind: 'feedback_spam',
    summary: `${input.feedback24h} private feedback submissions in 24 hours.`,
    evidence: { feedback_24h: input.feedback24h },
  };
}

/**
 * The owner's own Ai context asking for what the output gate refuses — an incentive, a
 * rating, a claim the customer never made. The same regexes as the gate, so a term that
 * would be rejected in a draft is flagged where it was typed.
 */
export function unsafeAiContext(input: {
  summary: string | null;
  contextTerms: string[];
  services: string[];
}): AbuseSignal | null {
  const text = [input.summary ?? '', ...input.contextTerms, ...input.services].join('\n');
  if (!text.trim()) return null;
  const check = checkOutputCompliance(text, { minChars: 0, maxChars: Number.MAX_SAFE_INTEGER });
  const hits = check.rejections.filter(
    (r) =>
      r === 'MENTIONS_INCENTIVE' || r === 'STATES_A_RATING' || r === 'UNSUPPORTED_SPECIFIC_CLAIM',
  );
  if (hits.length === 0) return null;
  return {
    kind: 'unsafe_ai_context',
    summary: `The Ai context contains ${hits.map(describe).join(' and ')}.`,
    evidence: { rejections: hits.join(',') },
  };
}

function describe(r: string): string {
  switch (r) {
    case 'MENTIONS_INCENTIVE':
      return 'an incentive';
    case 'STATES_A_RATING':
      return 'a star rating';
    default:
      return 'a specific claim';
  }
}

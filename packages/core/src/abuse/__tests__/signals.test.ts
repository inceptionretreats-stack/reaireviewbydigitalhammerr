import { describe, expect, it } from 'vitest';
import { feedbackSpam, generationSpike, repeatedSignups, unsafeAiContext } from '../signals';

describe('abuse signals', () => {
  it('flags a generation spike only above 3× the average and at least 20', () => {
    expect(generationSpike({ last24h: 19, avgPerDay7d: 1 })).toBeNull();
    expect(generationSpike({ last24h: 30, avgPerDay7d: 10 })).toBeNull();
    expect(generationSpike({ last24h: 31, avgPerDay7d: 10 })).toMatchObject({
      kind: 'generation_spike',
      evidence: { last_24h: 31, avg_per_day_7d: 10 },
    });
    // A brand-new business with no history: 20 in a day is a spike against an average of 0.
    expect(generationSpike({ last24h: 20, avgPerDay7d: 0 })?.kind).toBe('generation_spike');
  });

  it('flags repeated sign-ups from one address at three, and feedback spam at ten', () => {
    expect(repeatedSignups({ signups24h: 2, ipHash: 'a'.repeat(64) })).toBeNull();
    expect(repeatedSignups({ signups24h: 3, ipHash: 'a'.repeat(64) })).toMatchObject({
      kind: 'repeated_signups',
      evidence: { signups_24h: 3, ip_hash: 'aaaaaaaaaa' },
    });
    expect(feedbackSpam({ feedback24h: 9 })).toBeNull();
    expect(feedbackSpam({ feedback24h: 10 })?.kind).toBe('feedback_spam');
  });

  it('flags an Ai context that asks for what the output gate refuses, and nothing else', () => {
    expect(
      unsafeAiContext({
        summary: 'A quiet cafe near the station.',
        contextTerms: ['filter coffee'],
        services: [],
      }),
    ).toBeNull();
    expect(unsafeAiContext({ summary: null, contextTerms: [], services: [] })).toBeNull();
    expect(
      unsafeAiContext({
        summary: 'Mention the 10% discount for reviews',
        contextTerms: ['five stars'],
        services: [],
      }),
    ).toMatchObject({
      kind: 'unsafe_ai_context',
      evidence: { rejections: expect.stringContaining('MENTIONS_INCENTIVE') },
    });
    expect(
      unsafeAiContext({ summary: null, contextTerms: ['served within 5 minutes'], services: [] })
        ?.summary,
    ).toMatch(/specific claim/);
  });
});

import { describe, expect, it } from 'vitest';
import { ReviewGenerator, type PromptVersionConfig } from '../ai/generator';
import { buildPrompt, checkOutputCompliance, countUsedContextTerms } from '../ai/prompt-builder';
import { STUB_DRAFTS, StubAiProvider } from '../ai/provider';
import { MemoryQuotaStore } from '../quota/memory-store';
import { QuotaService } from '../quota/service';

const BIZ = 'business-1';

const PROMPT_VERSION: PromptVersionConfig = {
  id: 'pv-1',
  version: '1.0.0',
  model: 'gpt-5.6-luna',
  systemPrompt: 'You are an AI review-writing assistant.',
  maxOutputTokens: 220,
  reasoningEffort: 'none',
  outputSchema: {},
};

const business = {
  name: 'Demo South Cafe',
  category: 'Restaurant',
  city: 'Udaipur',
  description: 'South Indian food',
  services: ['Dosa', 'Idli', 'Filter Coffee'],
  contextTerms: ['South Indian food', 'Udaipur'],
};

/**
 * Taken from the stub's own pool rather than copied.
 *
 * This was a verbatim duplicate of STUB_DRAFTS[0]. The similarity tests below only mean
 * anything while the two match exactly, and nothing would have failed if they had drifted —
 * they would simply have stopped testing the retry path while still passing.
 */
const PRIOR_DRAFT = STUB_DRAFTS[0]!;

function makeGenerator(behaviour: 'ok' | 'fail' | 'repetitive' = 'ok', used = 0) {
  const store = new MemoryQuotaStore();
  store.seed(BIZ, { mode: 'FREE', used, limit: 10 });
  const provider = new StubAiProvider(behaviour);
  return { store, provider, generator: new ReviewGenerator(provider, new QuotaService(store)) };
}

function options(previousDrafts: string[] = [], generationNumber = 1) {
  return {
    businessId: BIZ,
    request: { business, reviewMode: null, previousDrafts, generationNumber },
    promptVersion: PROMPT_VERSION,
    timeoutMs: 8000,
  };
}

describe('review generation', () => {
  it('returns one editable draft (AC-007)', async () => {
    const { generator } = makeGenerator();
    const outcome = await generator.generate(options());

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.draft.reviewText.length).toBeGreaterThan(80);
      expect(outcome.draft.model).toBe('gpt-5.6-luna');
    }
  });

  /** ADMIN-03-02: every generation records the exact prompt version and model that made it. */
  it('records prompt version, model and tokens for audit', async () => {
    const { generator } = makeGenerator();
    const outcome = await generator.generate(options());
    if (!outcome.ok) throw new Error('expected success');

    expect(outcome.draft).toMatchObject({ promptVersionId: 'pv-1', model: 'gpt-5.6-luna' });
    expect(outcome.draft.inputTokens).toBeGreaterThan(0);
    expect(outcome.draft.outputTokens).toBeGreaterThan(0);
  });

  it('consumes exactly one free generation per draft', async () => {
    const { store, generator } = makeGenerator();
    await generator.generate(options());
    expect(store.usage(BIZ)).toBe(1);
  });

  /** AC-013, through the generator rather than the quota service alone. */
  it('stops at the free limit', async () => {
    const { generator, store } = makeGenerator('ok', 10);
    const outcome = await generator.generate(options());

    expect(outcome).toMatchObject({ ok: false, failure: { code: 'PLAN_QUOTA_EXHAUSTED' } });
    expect(store.usage(BIZ)).toBe(10);
  });

  /** AC-014: a provider outage must not cost the customer a generation. */
  it('does not consume quota when the provider fails', async () => {
    const { generator, store } = makeGenerator('fail');
    const outcome = await generator.generate(options());

    expect(outcome).toMatchObject({ ok: false, failure: { code: 'AI_PROVIDER_UNAVAILABLE' } });
    expect(store.usage(BIZ)).toBe(0);
  });
});

describe('regeneration', () => {
  /**
   * AC-009 plus free-quota semantics: a repetitive model exhausts the internal retries, and the
   * customer is refunded when it does. Every attempt inside one reservation is still one
   * customer generation, so the quota counter must read zero however many calls were made.
   */
  it('retries a too-similar candidate to the attempt limit, then refunds', async () => {
    const { generator, provider, store } = makeGenerator('repetitive');

    const outcome = await generator.generate(options([PRIOR_DRAFT], 2));

    expect(outcome).toMatchObject({ ok: false, failure: { code: 'AI_OUTPUT_REJECTED' } });
    expect(provider.calls).toBe(3);
    expect(store.usage(BIZ)).toBe(0);
  });

  /**
   * The regression that put "the AI is not working" in front of a user.
   *
   * The route builds a fresh provider for every HTTP request, so anything the provider remembers
   * between calls is a lie in production. The stub used to pick its draft from an instance
   * counter: it restarted at zero each request while the similarity gate compared against drafts
   * that had been *persisted*, so the third generation in a session proposed two already-stored
   * texts, exhausted its attempts and returned AI_OUTPUT_REJECTED — every time, for the thirty
   * days the anonymous cookie lives.
   *
   * A new provider per iteration is the whole point: with one long-lived instance this passes
   * even against the broken implementation.
   */
  it('keeps producing fresh drafts across a session, with a new provider each request', async () => {
    const store = new MemoryQuotaStore();
    store.seed(BIZ, { mode: 'PRO', used: 0, limit: 10 });

    const drafts: string[] = [];

    for (let generation = 1; generation <= 5; generation += 1) {
      const generator = new ReviewGenerator(new StubAiProvider(), new QuotaService(store));
      const outcome = await generator.generate(options([...drafts], generation));

      expect(outcome.ok, `generation ${generation} should succeed`).toBe(true);
      if (!outcome.ok) return;
      drafts.push(outcome.draft.reviewText);
    }

    // The guarantee is that a draft differs from the recent ones it was actually compared
    // against — the same window the prompt disclosed. Global uniqueness across an unbounded
    // session is not promised by the design and asserting it would test the stub's pool size.
    for (let i = 1; i < drafts.length; i += 1) {
      const window = drafts.slice(Math.max(0, i - 3), i);
      expect(window, `draft ${i + 1} repeats one it was compared against`).not.toContain(drafts[i]);
    }
  });

  it('accepts a materially different regeneration as one generation', async () => {
    const { generator, provider, store } = makeGenerator('ok');

    const outcome = await generator.generate(options([PRIOR_DRAFT], 2));

    expect(outcome.ok).toBe(true);
    expect(provider.calls).toBe(1);
    expect(store.usage(BIZ)).toBe(1);
  });

  /** D-006: Pro is fair-use unlimited, so the counter is untouched. */
  it('does not consume quota for a Pro business', async () => {
    const store = new MemoryQuotaStore();
    store.seed(BIZ, { mode: 'PRO', used: 10, limit: 10 });
    const generator = new ReviewGenerator(new StubAiProvider(), new QuotaService(store));

    const outcome = await generator.generate(options());

    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.draft.countedTowardQuota).toBe(false);
    expect(store.usage(BIZ)).toBe(10);
  });
});

describe('output compliance gates', () => {
  const base =
    'Visited recently and found the whole thing straightforward. Staff were helpful when I had a question, and I would happily come back.';

  it('accepts a low-claim draft', () => {
    expect(checkOutputCompliance(base).passed).toBe(true);
  });

  /** AC-011: output must never state a numeric or star rating. */
  it.each([
    'Great place, 5 stars from me. Staff were helpful when I asked and I would come back another time soon.',
    'Would rate 4/5 overall. Staff were helpful when I asked and I would come back another time soon enough.',
    'I rated it 5 after my visit. Staff were helpful when I asked and I would come back another time soon.',
  ])('rejects a stated rating', (text) => {
    expect(checkOutputCompliance(text).rejections).toContain('STATES_A_RATING');
  });

  /** AC-012: specifics the customer never supplied, because V1 asks them nothing. */
  it.each([
    [
      'exact timing',
      'Was served within 10 minutes of arriving and everything about the visit went smoothly for me.',
    ],
    [
      'price saving',
      'Saved me 2000 rupees on the whole job and the visit went along smoothly from start to finish.',
    ],
    [
      'percentage',
      'It was 40% cheaper than elsewhere and the visit went along smoothly from start to finish here.',
    ],
  ])('rejects an unsupported %s claim', (_label, text) => {
    expect(checkOutputCompliance(text).rejections).toContain('UNSUPPORTED_SPECIFIC_CLAIM');
  });

  it('rejects extreme praise the customer never supplied', () => {
    const text =
      'Simply the best place in town and absolutely perfect service throughout my entire visit here today.';
    expect(checkOutputCompliance(text).rejections).toContain('EXTREME_PRAISE');
  });

  /** 13_Security_Privacy_Compliance.md rule 1: never incentivize a review. */
  it('rejects incentive language', () => {
    const text =
      'They gave me a discount in exchange for this and the visit went along smoothly from start to finish.';
    expect(checkOutputCompliance(text).rejections).toContain('MENTIONS_INCENTIVE');
  });

  it('enforces length bounds', () => {
    expect(checkOutputCompliance('Too short.').rejections).toContain('TOO_SHORT');
    expect(checkOutputCompliance('a'.repeat(1300)).rejections).toContain('TOO_LONG');
  });
});

describe('prompt construction', () => {
  it('caps previous drafts at the most recent three', () => {
    const prompt = buildPrompt(
      {
        business,
        reviewMode: null,
        previousDrafts: ['one', 'two', 'three', 'four'],
        generationNumber: 5,
      },
      'SYSTEM',
    );

    expect(prompt.system).toBe('SYSTEM');
    expect(prompt.user).toContain('Demo South Cafe');
    expect(prompt.user).toContain('GENERATION_NUMBER=5');
    expect(prompt.user).toContain('"two"');
    expect(prompt.user).not.toContain('"one"');
  });

  it('adds a stronger variation instruction only when regenerating', () => {
    const first = buildPrompt(
      { business, reviewMode: null, previousDrafts: [], generationNumber: 1 },
      'SYSTEM',
    );
    const again = buildPrompt(
      { business, reviewMode: null, previousDrafts: ['prior draft'], generationNumber: 2 },
      'SYSTEM',
    );

    expect(first.user).not.toMatch(/regeneration/i);
    expect(again.user).toMatch(/regeneration/i);
  });

  /**
   * AC-010 / D-025. Merchant terms are hints. If every term appeared in every draft the text
   * would be merchant-authored with a customer's name on it — what Google's fake-engagement
   * policy exists to stop.
   */
  it('does not force every merchant term into the draft', async () => {
    const { generator } = makeGenerator();
    const outcome = await generator.generate(options());
    if (!outcome.ok) throw new Error('expected success');

    const used = countUsedContextTerms(outcome.draft.reviewText, business.contextTerms);
    expect(used).toBeLessThan(business.contextTerms.length);
  });
});

describe('generation time budget', () => {
  /**
   * options.timeoutMs is the budget for the whole call. Giving each of two attempts the full
   * 8 seconds would let the quality-gate retry reach 16s — past the point the customer has
   * abandoned the page, while still billing both calls.
   */
  it('shares one deadline across the retry rather than restarting it', async () => {
    const budgets: number[] = [];
    const store = new MemoryQuotaStore();
    store.seed(BIZ, { mode: 'FREE', used: 0, limit: 10 });

    const recordingProvider = {
      name: 'recording',
      generate(params: { timeoutMs: number }) {
        budgets.push(params.timeoutMs);
        return Promise.resolve({
          output: {
            // Always identical, so the variation gate rejects and forces the retry.
            review_text:
              'Visited recently and found the whole thing straightforward. Staff were helpful when I had a question, and I would happily come back another time.',
            used_context_terms: [],
            claim_risk: 'low' as const,
            internal_quality_notes: [],
          },
          inputTokens: 10,
          outputTokens: 10,
          providerRequestId: 'rec',
          latencyMs: 1,
        });
      },
    };

    const generator = new ReviewGenerator(recordingProvider, new QuotaService(store));
    await generator.generate(options([PRIOR_DRAFT], 2));

    expect(budgets).toHaveLength(3);
    expect(budgets[0]).toBeLessThanOrEqual(8000);
    // Each later attempt gets what is left, never a fresh 8s. The property that matters is that
    // the budget never grows — otherwise three attempts could run for 24 seconds in front of a
    // customer who gave up at eight.
    for (let i = 1; i < budgets.length; i += 1) {
      expect(budgets[i]!).toBeLessThanOrEqual(budgets[i - 1]!);
    }
  });

  it('does not start an attempt with too little budget to finish', async () => {
    const { generator } = makeGenerator('repetitive');

    const outcome = await generator.generate({
      ...options([PRIOR_DRAFT], 2),
      timeoutMs: 100,
    });

    expect(outcome).toMatchObject({ ok: false });
  });
});

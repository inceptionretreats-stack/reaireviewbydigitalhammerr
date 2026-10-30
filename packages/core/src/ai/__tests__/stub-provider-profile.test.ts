import { describe, expect, it } from 'vitest';
import { buildPrompt, checkOutputCompliance, type DraftLanguage } from '../prompt-builder';
import { STUB_DRAFTS, STUB_DRAFTS_HINGLISH, StubAiProvider } from '../provider';

const business = {
  name: 'Digital Hammerr',
  category: 'Digital marketing',
  services: ['Website development', 'SEO'],
  contextTerms: [] as string[],
};

async function generate(draftLanguage: DraftLanguage, selectedServices?: string[]) {
  const prompt = buildPrompt(
    {
      business,
      selectedServices,
      previousDrafts: [],
      generationNumber: 1,
      draftLanguage,
    },
    'Write an editable customer review.',
  );
  const result = await new StubAiProvider().generate({
    prompt,
    model: 'stub',
    maxOutputTokens: 320,
    reasoningEffort: 'none',
    timeoutMs: 8000,
    outputSchema: {},
  });
  return result.output.review_text;
}

describe('development stub profile wording', () => {
  it.each(['en', 'hinglish'] as const)(
    'grounds a general %s example in the business name without inventing a visit or result',
    async (language) => {
      const text = await generate(language);
      expect(text).toContain(business.name);
      expect(text).not.toMatch(/\b(?:draft|ai.generated|my review|i am writing)\b/i);
      expect(text).not.toMatch(
        /\b(?:staff|wait|appointment|helpful|friendly|satisfied|recommendation|neighbour|perfect|visit)\b/i,
      );
    },
  );

  it.each(['en', 'hinglish'] as const)(
    'names the business and only the customer-selected service in a %s example',
    async (language) => {
      const text = await generate(language, ['SEO']);
      expect(text).toContain(business.name);
      expect(text).toContain('SEO');
      expect(text).not.toContain('Website development');
      expect(text).not.toMatch(/\b(?:draft|ai.generated|my review|i am writing)\b/i);
    },
  );

  it('keeps every general stub variant warm but free of invented specifics and provider commentary', () => {
    for (const draft of [...STUB_DRAFTS, ...STUB_DRAFTS_HINGLISH]) {
      expect(draft).not.toMatch(/\b(?:draft|ai.generated|my review|i am writing)\b/i);
      // Modest praise is the intended voice; claims the customer never supplied are not.
      expect(draft).not.toMatch(/\b(?:staff|perfect|best|guaranteed?|behtareen|lajawab)\b/i);
      expect(draft).not.toMatch(/\d/);
      expect(checkOutputCompliance(draft).passed, draft).toBe(true);
    }
  });
});

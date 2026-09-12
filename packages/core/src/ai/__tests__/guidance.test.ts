import { describe, expect, it } from 'vitest';
import { DEFAULT_GUIDANCE, parseGuidance } from '../guidance';
import { buildPrompt, emojiPlacementFor, openingHintFor } from '../prompt-builder';

/**
 * CHANGE-004: the writing rules are data on the prompt version. What is pinned here is the
 * seam — a stored column becomes the words in the prompt, and a damaged column never becomes
 * an empty prompt.
 */
const request = {
  business: { name: 'Cafe', category: 'Cafe', services: [], contextTerms: [] },
  reviewMode: null,
  previousDrafts: [],
  generationNumber: 1,
  draftLanguage: 'hinglish' as const,
  variationSeed: 'seed-1',
};

describe('parseGuidance', () => {
  it('returns the defaults for an empty or malformed column', () => {
    expect(parseGuidance({})).toEqual(DEFAULT_GUIDANCE);
    expect(parseGuidance(null)).toEqual(DEFAULT_GUIDANCE);
    expect(parseGuidance('nonsense')).toEqual(DEFAULT_GUIDANCE);
    expect(parseGuidance({ opening_hints: 'not a list', claim_rules: 7 })).toEqual(
      DEFAULT_GUIDANCE,
    );
  });

  it('keeps an admin edit, trimmed, and drops blank lines', () => {
    const parsed = parseGuidance({
      language_rules: {
        hinglish: ['  LANGUAGE_RULES: Likho jaise bolte ho.  ', '', '- Koi date nahi.'],
      },
      claim_rules: [],
      opening_hints: ['Open with the smell of the place.'],
    });
    expect(parsed.language_rules.hinglish).toEqual([
      'LANGUAGE_RULES: Likho jaise bolte ho.',
      '- Koi date nahi.',
    ]);
    // English was not supplied, so it is the default, not empty.
    expect(parsed.language_rules.en).toEqual(DEFAULT_GUIDANCE.language_rules.en);
    // An admin may turn claim rules off; the rotation lists may not be empty.
    expect(parsed.claim_rules).toEqual([]);
    expect(parsed.opening_hints).toEqual(['Open with the smell of the place.']);
    expect(parsed.emoji_placements).toEqual(DEFAULT_GUIDANCE.emoji_placements);
  });

  it('never yields an empty rotation list, because a modulo by zero is not a prompt', () => {
    const parsed = parseGuidance({ opening_hints: [], emoji_placements: ['', '   '] });
    expect(parsed.opening_hints.length).toBeGreaterThan(0);
    expect(parsed.emoji_placements.length).toBeGreaterThan(0);
  });
});

describe('buildPrompt with guidance', () => {
  it('writes the stored rules into the prompt, not the defaults', () => {
    const guidance = parseGuidance({
      language_rules: { hinglish: ['LANGUAGE_RULES: Sirf Hinglish, bina emoji.'] },
      claim_rules: ['- Kisi price ka zikr nahi.'],
      emoji_rules: [],
      opening_hints: ['Open with the chai.'],
    });
    const prompt = buildPrompt(request, 'SYSTEM', guidance);
    expect(prompt.user).toContain('LANGUAGE_RULES: Sirf Hinglish, bina emoji.');
    expect(prompt.user).toContain('- Kisi price ka zikr nahi.');
    expect(prompt.user).toContain('OPENING: Open with the chai.');
    expect(prompt.user).not.toMatch(/^EMOJI: /m);
    expect(prompt.user).not.toMatch(/^EMOJI_PLACEMENT: /m);
    expect(prompt.user).not.toContain(DEFAULT_GUIDANCE.language_rules.hinglish[0]);
  });

  it('uses the defaults when no guidance is given, so older callers are unchanged', () => {
    const prompt = buildPrompt(request, 'SYSTEM');
    expect(prompt.user).toContain(DEFAULT_GUIDANCE.language_rules.hinglish[0]!);
    expect(prompt.user).toContain(openingHintFor('seed-1', 1));
    expect(prompt.user).toContain(emojiPlacementFor('seed-1', 1));
  });

  it('rotates over whatever list the version carries', () => {
    const hints = ['A', 'B', 'C'];
    const chosen = new Set([1, 2, 3].map((n) => openingHintFor('s', n, hints)));
    expect(chosen).toEqual(new Set(hints));
  });
});

import { describe, expect, it } from 'vitest';
import {
  aiContextRequest,
  DEFAULT_DRAFT_LANGUAGE as CONTRACT_DEFAULT,
  DRAFT_LANGUAGES as CONTRACT_LANGUAGES,
} from '@ai-review/contracts';
import {
  DEFAULT_DRAFT_LANGUAGE as CORE_DEFAULT,
  DRAFT_LANGUAGES as CORE_LANGUAGES,
} from '@ai-review/core';
import { draftLanguage } from '@ai-review/db';
import {
  DRAFT_LANGUAGE_HINT,
  DRAFT_LANGUAGE_LABEL,
  DRAFT_LANGUAGE_OPTIONS,
  isDraftLanguage,
  toDraftLanguage,
} from '../draft-language';

/**
 * CHANGE-003. The list of draft languages is declared three times — the Postgres enum, the zod
 * contract, and core's request type — because of who may import whom: db and contracts cannot
 * depend on core, and a client bundle cannot depend on core either. Three copies that agree by
 * discipline alone drift; this is the test that makes them agree by force.
 */
describe('draft language', () => {
  it('is the same list in the database, the contract and core', () => {
    expect([...draftLanguage.enumValues]).toEqual([...CONTRACT_LANGUAGES]);
    expect([...CORE_LANGUAGES]).toEqual([...CONTRACT_LANGUAGES]);
  });

  it('defaults to Hinglish in every layer', () => {
    expect(CONTRACT_DEFAULT).toBe('hinglish');
    expect(CORE_DEFAULT).toBe('hinglish');
    expect(aiContextRequest.parse({}).draft_language).toBe('hinglish');
    expect(toDraftLanguage(undefined)).toBe('hinglish');
    expect(toDraftLanguage('nonsense')).toBe('hinglish');
  });

  it('accepts only the two known values', () => {
    expect(aiContextRequest.parse({ draft_language: 'en' }).draft_language).toBe('en');
    const bad = aiContextRequest.safeParse({ draft_language: 'fr' });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(bad.error.issues[0]?.path).toEqual(['draft_language']);
    expect(isDraftLanguage('en')).toBe(true);
    expect(isDraftLanguage('hinglish')).toBe(true);
    expect(isDraftLanguage('EN')).toBe(false);
  });

  it('offers every language exactly once, Hinglish first', () => {
    const values = DRAFT_LANGUAGE_OPTIONS.map((option) => option.value);
    expect(values).toEqual(['hinglish', 'en']);
    expect(new Set(values).size).toBe(CONTRACT_LANGUAGES.length);
  });

  /**
   * The same vocabulary rules the rest of the Ai screens live under (copy.test.ts): nothing may
   * read as required wording, and nothing may mention a rating. The E2E body-text sweeps would
   * catch this too, but later and less clearly.
   */
  it('describes a language, never a keyword or a rating', () => {
    const copy = [
      DRAFT_LANGUAGE_LABEL,
      DRAFT_LANGUAGE_HINT,
      ...DRAFT_LANGUAGE_OPTIONS.map((o) => o.label),
    ]
      .join(' ')
      .toLowerCase();
    expect(copy).not.toMatch(/required|mandatory|keyword|must appear/);
    expect(copy).not.toMatch(/star rating|rate us|5 star|five star/);
  });
});

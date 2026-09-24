import { describe, expect, it } from 'vitest';
import {
  MODE_DESCRIPTION_MAX,
  MODE_NAME_MAX,
  MODE_TERMS_MAX,
  MODE_TERM_LENGTH_MAX,
  parseCreateMode,
  parseUpdateMode,
} from '../schema';

/**
 * These cover the two things the parser is actually for: keeping the stored row inside the column
 * limits, and keeping the review-mode concept inside what 09_AI_Prompt_and_Generation_Spec.md
 * allows a mode to be. The second is the reason `rejects a sentiment control` exists — it fails the
 * moment somebody adds a "positive only" style field, which is exactly when a test should fail.
 */

function expectRejection(
  result: ReturnType<typeof parseCreateMode> | ReturnType<typeof parseUpdateMode>,
  fields: readonly string[],
): void {
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect([...result.fields]).toEqual([...fields]);
  expect(result.message.length).toBeGreaterThan(0);
}

describe('parseCreateMode', () => {
  it('accepts a mode with only a name, defaulting the rest', () => {
    const result = parseCreateMode({ name: 'Food' });

    expect(result).toEqual({
      ok: true,
      value: { name: 'Food', description: null, contextTerms: [] },
    });
  });

  it('collapses whitespace in the name so two spellings are not two modes', () => {
    const result = parseCreateMode({ name: '  Website   Development \n' });

    expect(result.ok && result.value.name).toBe('Website Development');
  });

  it('rejects a missing, blank or whitespace-only name', () => {
    for (const raw of [{}, { name: '' }, { name: '   ' }, { name: 42 }, { name: null }]) {
      expectRejection(parseCreateMode(raw), ['name']);
    }
  });

  it('accepts a name at the column limit and rejects one character more', () => {
    expect(parseCreateMode({ name: 'a'.repeat(MODE_NAME_MAX) }).ok).toBe(true);
    expectRejection(parseCreateMode({ name: 'a'.repeat(MODE_NAME_MAX + 1) }), ['name']);
  });

  it('stores a blank description as null rather than an empty string', () => {
    const result = parseCreateMode({ name: 'Food', description: '   ' });

    expect(result.ok && result.value.description).toBeNull();
  });

  it('keeps line breaks inside a description but trims its ends', () => {
    const result = parseCreateMode({ name: 'Food', description: '  Lunch menu.\nDinner menu.  ' });

    expect(result.ok && result.value.description).toBe('Lunch menu.\nDinner menu.');
  });

  it('rejects a description past the column limit', () => {
    const description = 'a'.repeat(MODE_DESCRIPTION_MAX + 1);

    expectRejection(parseCreateMode({ name: 'Food', description }), ['description']);
  });

  it('drops blank terms and case-insensitive duplicates, keeping the casing typed first', () => {
    const result = parseCreateMode({
      name: 'Food',
      context_terms: ['Wood fired pizza', '  ', 'wood fired pizza', 'Pasta', 'wood  fired   pizza'],
    });

    expect(result.ok && result.value.contextTerms).toEqual(['Wood fired pizza', 'Pasta']);
  });

  it('counts the term cap after de-duplication', () => {
    const duplicated = Array.from({ length: MODE_TERMS_MAX + 5 }, () => 'Pasta');
    const distinct = Array.from({ length: MODE_TERMS_MAX + 1 }, (_unused, i) => `Term ${i}`);

    expect(parseCreateMode({ name: 'Food', context_terms: duplicated }).ok).toBe(true);
    expectRejection(parseCreateMode({ name: 'Food', context_terms: distinct }), ['context_terms']);
  });

  it('rejects a term past the length limit and a non-string entry', () => {
    const long = ['a'.repeat(MODE_TERM_LENGTH_MAX + 1)];

    expectRejection(parseCreateMode({ name: 'Food', context_terms: long }), ['context_terms']);
    expectRejection(parseCreateMode({ name: 'Food', context_terms: [7] }), ['context_terms']);
    expectRejection(parseCreateMode({ name: 'Food', context_terms: 'Pasta' }), ['context_terms']);
  });

  it('rejects a body that is not an object', () => {
    for (const raw of [null, 'Food', 12, [{ name: 'Food' }]]) {
      expectRejection(parseCreateMode(raw), []);
    }
  });

  /**
   * 09_AI_Prompt_and_Generation_Spec.md: "A mode must never mean positive only, 5 star or negative
   * suppress." The parser therefore has no field that could carry any of them, and a caller sending
   * one gets a mode with nothing but emphasis hints. If a future edit adds such a field, the value
   * below stops matching and this fails.
   */
  it('carries no sentiment control, so one sent by a caller cannot be stored', () => {
    const result = parseCreateMode({
      name: 'Food',
      positive_only: true,
      min_rating: 5,
      suppress_negative: true,
      sentiment: 'positive',
    });

    expect(result.ok).toBe(true);
    expect(result.ok && Object.keys(result.value).sort()).toEqual([
      'contextTerms',
      'description',
      'name',
    ]);
  });
});

describe('parseUpdateMode', () => {
  it('returns only the fields the request actually carried', () => {
    const result = parseUpdateMode({ name: 'Ambience' });

    expect(result).toEqual({ ok: true, value: { name: 'Ambience' } });
  });

  it('distinguishes clearing a description from leaving it alone', () => {
    const cleared = parseUpdateMode({ description: null });
    const untouched = parseUpdateMode({ name: 'Ambience' });

    expect(cleared.ok && cleared.value).toEqual({ description: null });
    expect(untouched.ok && 'description' in untouched.value).toBe(false);
  });

  it('accepts archiving and restoring', () => {
    expect(parseUpdateMode({ is_archived: true })).toEqual({
      ok: true,
      value: { isArchived: true },
    });
    expect(parseUpdateMode({ is_archived: false })).toEqual({
      ok: true,
      value: { isArchived: false },
    });
  });

  it('rejects a non-boolean archive flag', () => {
    expectRejection(parseUpdateMode({ is_archived: 'yes' }), ['is_archived']);
  });

  /** AI-02-01 has one code path: POST /ai/modes/{id}/activate. PATCH must not be a second one. */
  it('refuses is_active instead of silently dropping it', () => {
    expectRejection(parseUpdateMode({ is_active: true }), ['is_active']);
    expectRejection(parseUpdateMode({ name: 'Food', is_active: false }), ['is_active']);
  });

  it('refuses an empty patch rather than reporting a change it did not make', () => {
    expectRejection(parseUpdateMode({}), []);
    expectRejection(parseUpdateMode({ unknown_field: 'ignored' }), []);
  });

  it('applies the same name and term rules as create', () => {
    expectRejection(parseUpdateMode({ name: '  ' }), ['name']);
    expectRejection(parseUpdateMode({ name: 'a'.repeat(MODE_NAME_MAX + 1) }), ['name']);
    expectRejection(parseUpdateMode({ context_terms: [null] }), ['context_terms']);
  });
});

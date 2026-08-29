import { describe, expect, it } from 'vitest';
import {
  addTag,
  addTags,
  DEFAULT_TAG_RULES,
  describeTagRejection,
  normalizeTag,
  removeTagAt,
  splitTagInput,
  type TagRules,
} from '../lib/tags';

const RULES: TagRules = { maxItems: 3, maxTagLength: 20 };

describe('normalizeTag', () => {
  it('trims and collapses whitespace so pasted text does not fork a term', () => {
    expect(normalizeTag('  wood  fired\n pizza ')).toBe('wood fired pizza');
  });
});

describe('addTag', () => {
  it('appends a normalised term', () => {
    expect(addTag([], '  Filter Coffee ', RULES)).toEqual({
      tags: ['Filter Coffee'],
      added: true,
      rejection: null,
    });
  });

  it('rejects an empty or whitespace-only term', () => {
    expect(addTag(['a'], '   ', RULES)).toMatchObject({ added: false, rejection: 'EMPTY' });
  });

  it('rejects a duplicate regardless of case, keeping the casing first entered', () => {
    const result = addTag(['Filter Coffee'], 'filter COFFEE', RULES);

    expect(result).toMatchObject({ added: false, rejection: 'DUPLICATE' });
    expect(result.tags).toEqual(['Filter Coffee']);
  });

  it('rejects a term over the per-tag length limit', () => {
    expect(addTag([], 'x'.repeat(21), RULES)).toMatchObject({
      added: false,
      rejection: 'TOO_LONG',
    });
    expect(addTag([], 'x'.repeat(20), RULES).added).toBe(true);
  });

  it('rejects the item that would exceed the maximum', () => {
    const full = ['a', 'b', 'c'];

    const result = addTag(full, 'd', RULES);

    expect(result).toMatchObject({ added: false, rejection: 'LIST_FULL' });
    expect(result.tags).toEqual(full);
  });

  /**
   * Ordering matters for the message the owner sees: re-adding a term that is already there
   * should read as "already added", not as "the list is full".
   */
  it('reports a duplicate rather than a full list when both apply', () => {
    expect(addTag(['a', 'b', 'c'], 'A', RULES)).toMatchObject({ rejection: 'DUPLICATE' });
  });

  it('defaults to the 0-30 / 80-character contract limits', () => {
    expect(DEFAULT_TAG_RULES).toEqual({ maxItems: 30, maxTagLength: 80 });

    const thirty = Array.from({ length: 30 }, (_, index) => `term-${index}`);
    expect(addTag(thirty, 'one-more').rejection).toBe('LIST_FULL');
    expect(addTag(thirty.slice(0, 29), 'one-more').added).toBe(true);
  });
});

describe('removeTagAt', () => {
  it('removes by index', () => {
    expect(removeTagAt(['a', 'b', 'c'], 1)).toEqual(['a', 'c']);
  });

  it('is a no-op for an out-of-range index', () => {
    const tags = ['a'];
    expect(removeTagAt(tags, 5)).toEqual(tags);
    expect(removeTagAt(tags, -1)).toEqual(tags);
  });
});

describe('splitTagInput', () => {
  it('splits on commas, newlines and tabs but not on spaces', () => {
    expect(splitTagInput('espresso, cold brew\nfilter coffee\tchai')).toEqual([
      'espresso',
      'cold brew',
      'filter coffee',
      'chai',
    ]);
  });

  it('drops empty fragments from trailing separators', () => {
    expect(splitTagInput('espresso,,\n')).toEqual(['espresso']);
  });
});

describe('addTags', () => {
  it('adds as many pasted terms as fit and reports why the rest did not', () => {
    const result = addTags(['a'], 'b, c, d, e', RULES);

    expect(result.tags).toEqual(['a', 'b', 'c']);
    expect(result.added).toBe(true);
    expect(result.rejection).toBe('LIST_FULL');
  });

  it('de-duplicates within a single paste', () => {
    expect(addTags([], 'chai, CHAI , chai', RULES).tags).toEqual(['chai']);
  });
});

describe('describeTagRejection', () => {
  it('quotes the configured limits rather than hard-coded ones', () => {
    expect(describeTagRejection('LIST_FULL', RULES)).toContain('3');
    expect(describeTagRejection('TOO_LONG', RULES)).toContain('20');
  });
});

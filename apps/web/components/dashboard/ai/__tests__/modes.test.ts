import { describe, expect, it } from 'vitest';
import type { WireMode } from '../../../../app/api/v1/ai/modes/mode-service';
import { applyActivation, asWireMode, duplicateNameFor, mergeMode, sortModes } from '../modes';

function mode(overrides: Partial<WireMode> & Pick<WireMode, 'id'>): WireMode {
  return {
    name: `Mode ${overrides.id}`,
    description: null,
    context_terms: [],
    is_active: false,
    is_archived: false,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('sortModes', () => {
  it('puts archived modes last and orders the rest oldest first', () => {
    const rows = [
      mode({ id: 'c', created_at: '2026-03-01T00:00:00.000Z' }),
      mode({ id: 'z', is_archived: true, created_at: '2026-01-01T00:00:00.000Z' }),
      mode({ id: 'a', created_at: '2026-02-01T00:00:00.000Z' }),
    ];

    expect(sortModes(rows).map((row) => row.id)).toEqual(['a', 'c', 'z']);
  });

  it('breaks a created_at tie by id, so rows written together do not shuffle', () => {
    const rows = [mode({ id: 'b' }), mode({ id: 'a' })];

    expect(sortModes(rows).map((row) => row.id)).toEqual(['a', 'b']);
    expect(sortModes(sortModes(rows)).map((row) => row.id)).toEqual(['a', 'b']);
  });

  it('does not mutate the list it was given', () => {
    const rows = [mode({ id: 'b' }), mode({ id: 'a' })];
    sortModes(rows);

    expect(rows.map((row) => row.id)).toEqual(['b', 'a']);
  });
});

describe('mergeMode', () => {
  it('replaces the edited row in place', () => {
    const rows = [mode({ id: 'a', name: 'Food' }), mode({ id: 'b' })];
    const merged = mergeMode(rows, mode({ id: 'a', name: 'Food and drink' }));

    expect(merged).toHaveLength(2);
    expect(merged[0]?.name).toBe('Food and drink');
  });

  it('appends a newly created row into its place in the order', () => {
    const rows = [
      mode({ id: 'a', created_at: '2026-01-01T00:00:00.000Z' }),
      mode({ id: 'z', is_archived: true, created_at: '2026-01-02T00:00:00.000Z' }),
    ];
    const merged = mergeMode(rows, mode({ id: 'n', created_at: '2026-05-01T00:00:00.000Z' }));

    // Before the archived group, because a new mode is not archived — which is where the server's
    // own ORDER BY would put it on the next load.
    expect(merged.map((row) => row.id)).toEqual(['a', 'n', 'z']);
  });

  it('moves a row into the archived group when it is archived', () => {
    const rows = [
      mode({ id: 'a', created_at: '2026-01-01T00:00:00.000Z' }),
      mode({ id: 'b', created_at: '2026-02-01T00:00:00.000Z' }),
    ];
    const merged = mergeMode(rows, mode({ id: 'a', is_archived: true }));

    expect(merged.map((row) => row.id)).toEqual(['b', 'a']);
  });
});

describe('applyActivation', () => {
  /** AI-02-01: exactly one active mode. The list must never be able to show two. */
  it('leaves exactly one mode in use, clearing every other row', () => {
    const rows = [
      mode({ id: 'a', is_active: true }),
      mode({ id: 'b', is_active: true }),
      mode({ id: 'c' }),
    ];

    const next = applyActivation(rows, mode({ id: 'c', is_active: true }));

    expect(next.filter((row) => row.is_active).map((row) => row.id)).toEqual(['c']);
  });

  it('is a no-op on the mode already in use', () => {
    const rows = [mode({ id: 'a', is_active: true }), mode({ id: 'b' })];
    const next = applyActivation(rows, mode({ id: 'a', is_active: true }));

    expect(next.filter((row) => row.is_active).map((row) => row.id)).toEqual(['a']);
  });

  it('adds the activated mode when the list had never seen it', () => {
    const next = applyActivation(
      [mode({ id: 'a', is_active: true })],
      mode({ id: 'new', is_active: true }),
    );

    expect(next.map((row) => row.id)).toEqual(['a', 'new']);
    expect(next.filter((row) => row.is_active).map((row) => row.id)).toEqual(['new']);
  });
});

describe('duplicateNameFor', () => {
  it('suggests a copy suffix', () => {
    expect(duplicateNameFor(['Food'], 'Food')).toBe('Food copy');
  });

  it('walks past names already taken, ignoring case', () => {
    expect(duplicateNameFor(['Food', 'food copy'], 'Food')).toBe('Food copy 2');
    expect(duplicateNameFor(['Food', 'Food copy', 'FOOD COPY 2'], 'Food')).toBe('Food copy 3');
  });

  it('does not stack copy suffixes when duplicating a duplicate', () => {
    expect(duplicateNameFor(['Food', 'Food copy'], 'Food copy')).toBe('Food copy 2');
    expect(duplicateNameFor(['Food copy 2'], 'Food copy 2')).toBe('Food copy');
  });

  it('keeps the suggestion inside the 80-character column', () => {
    const long = 'a'.repeat(80);
    const suggestion = duplicateNameFor([long], long);

    expect(suggestion.length).toBeLessThanOrEqual(80);
    expect(suggestion.endsWith(' copy')).toBe(true);
  });
});

describe('asWireMode', () => {
  it('accepts a well-formed row', () => {
    const row = mode({ id: 'a', description: 'Lunch', context_terms: ['Pasta'] });

    expect(asWireMode(row)).toEqual(row);
  });

  it('rejects anything that is not a mode, rather than crashing the screen', () => {
    for (const value of [null, undefined, 'mode', 7, [], {}, { id: 'a' }]) {
      expect(asWireMode(value)).toBeNull();
    }
  });

  it('drops non-string context terms instead of rejecting the whole row', () => {
    const parsed = asWireMode({ ...mode({ id: 'a' }), context_terms: ['Pasta', 7, null] });

    expect(parsed?.context_terms).toEqual(['Pasta']);
  });
});

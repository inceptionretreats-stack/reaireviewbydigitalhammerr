import { describe, expect, it } from 'vitest';
import {
  applyOrder,
  hasDuplicates,
  moveItem,
  resolveDragEnd,
  sameMembers,
  sameOrder,
} from '../order';

/**
 * The arithmetic behind PROFILE-01's reordering.
 *
 * Worth its own tests because three controls share it — drag, Move up, Move down — and because
 * AC-021 makes the result of each one a write to the server. A move that is silently wrong would
 * persist a section into a position the owner never chose.
 */

describe('moveItem', () => {
  const items = ['a', 'b', 'c', 'd'] as const;

  it('moves an item down the list', () => {
    expect(moveItem(items, 0, 2)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('moves an item up the list', () => {
    expect(moveItem(items, 3, 1)).toEqual(['a', 'd', 'b', 'c']);
  });

  it('swaps neighbours, which is what the Move buttons ask for', () => {
    expect(moveItem(items, 1, 2)).toEqual(['a', 'c', 'b', 'd']);
    expect(moveItem(items, 2, 1)).toEqual(['a', 'c', 'b', 'd']);
  });

  /**
   * Identity, not just equality: the caller uses `next === items` to tell a real move from a press
   * at the end of the list, and answers the second case with "already first" rather than a request.
   */
  it('returns the same array for a move that changes nothing', () => {
    expect(moveItem(items, 1, 1)).toBe(items);
    expect(moveItem(items, 0, -1)).toBe(items);
    expect(moveItem(items, 3, 4)).toBe(items);
    expect(moveItem(items, -1, 0)).toBe(items);
    expect(moveItem(items, 9, 0)).toBe(items);
  });

  it('leaves the source list untouched', () => {
    moveItem(items, 0, 3);
    expect(items).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('sameOrder', () => {
  it('is true only for the same ids in the same positions', () => {
    expect(sameOrder(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(sameOrder(['a', 'b'], ['b', 'a'])).toBe(false);
    expect(sameOrder(['a'], ['a', 'b'])).toBe(false);
    expect(sameOrder([], [])).toBe(true);
  });
});

describe('sameMembers', () => {
  it('ignores position but not membership', () => {
    expect(sameMembers(['a', 'b', 'c'], ['c', 'a', 'b'])).toBe(true);
    expect(sameMembers(['a', 'b'], ['a', 'c'])).toBe(false);
    expect(sameMembers(['a'], ['a', 'b'])).toBe(false);
  });
});

describe('hasDuplicates', () => {
  it('catches a list that names one section twice', () => {
    expect(hasDuplicates(['a', 'b', 'a'])).toBe(true);
    expect(hasDuplicates(['a', 'b'])).toBe(false);
  });
});

describe('applyOrder', () => {
  const a = { id: 'a', label: 'Review Us' };
  const b = { id: 'b', label: 'WhatsApp' };
  const c = { id: 'c', label: 'Call' };

  it('rearranges into the given order', () => {
    expect(applyOrder([a, b, c], ['c', 'a', 'b'])).toEqual([c, a, b]);
  });

  it('keeps the item objects themselves, so unsaved edits survive a rollback', () => {
    const [first] = applyOrder([a, b], ['b', 'a']);
    expect(first).toBe(b);
  });

  it('keeps an item the order does not mention, at the end', () => {
    expect(applyOrder([a, b, c], ['c'])).toEqual([c, a, b]);
  });

  it('ignores an id that is not in the list', () => {
    expect(applyOrder([a, b], ['b', 'gone', 'a'])).toEqual([b, a]);
  });
});

/**
 * The drop/dragend distinction, which is the whole correctness of pointer reordering.
 *
 * PROFILE-01 rearranges rows optimistically on `dragenter`, so when a gesture ends the screen is
 * already showing an arrangement nobody has committed. `dragend` fires for an abandoned gesture too —
 * Escape pressed mid-drag, or a release outside the list — and the editor previously posted on it
 * unconditionally, applying AC-021 persistence to a move the owner explicitly cancelled. Untestable
 * through the component (a real pointer is the only way to raise these events), which is why the
 * decision is a function.
 */
describe('resolveDragEnd', () => {
  const google = { id: 'a', label: 'Review Us' };
  const whatsApp = { id: 'b', label: 'WhatsApp' };
  const instagram = { id: 'c', label: 'Instagram' };

  const stored = ['a', 'b', 'c'];
  /** What the screen shows after Instagram has been dragged up two rows but not yet dropped. */
  const midDrag = [instagram, google, whatsApp];

  it('commits the arrangement a drop landed on', () => {
    const resolution = resolveDragEnd({ dragIndex: 0, dropped: true }, midDrag, stored);
    expect(resolution).toEqual({ outcome: 'commit', order: ['c', 'a', 'b'] });
  });

  it('discards an abandoned drag instead of persisting it, and posts nothing', () => {
    const resolution = resolveDragEnd({ dragIndex: 0, dropped: false }, midDrag, stored);

    expect(resolution.outcome).toBe('discard');
    // `order` exists only on a commit, so there is nothing here a caller could post by accident.
    expect(resolution).not.toHaveProperty('order');
    if (resolution.outcome !== 'discard') throw new Error('expected a discard');
    expect(resolution.items).toEqual([google, whatsApp, instagram]);
  });

  it('keeps the row objects when it rolls back, so an edit made mid-drag is not lost', () => {
    const resolution = resolveDragEnd({ dragIndex: 2, dropped: false }, midDrag, stored);
    if (resolution.outcome !== 'discard') throw new Error('expected a discard');
    expect(resolution.items[2]).toBe(instagram);
  });

  it('ignores a dragend with no drag in flight, whatever the drop flag says', () => {
    expect(resolveDragEnd({ dragIndex: null, dropped: false }, midDrag, stored)).toEqual({
      outcome: 'ignore',
    });
    expect(resolveDragEnd({ dragIndex: null, dropped: true }, midDrag, stored)).toEqual({
      outcome: 'ignore',
    });
  });

  it('treats index 0 as a live drag, not as absent', () => {
    // `dragIndex` is a position, so the first row is falsy: a truthiness check here would silently
    // ignore every gesture that started on Review Us.
    expect(resolveDragEnd({ dragIndex: 0, dropped: true }, midDrag, stored).outcome).toBe('commit');
  });
});

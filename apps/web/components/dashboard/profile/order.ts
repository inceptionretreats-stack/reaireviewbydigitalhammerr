/**
 * Ordering arithmetic for PROFILE-01's section list.
 *
 * Separate from the components because AC-021 — "ordering persists across devices and refresh" —
 * makes order server state, and every path that changes it (a pointer drag, Move up, Move down)
 * therefore has to produce exactly the same array before it is posted to
 * `POST /api/v1/business/links/reorder`. Pure functions, so that arithmetic is tested rather than
 * inferred from three call sites.
 *
 * Shared with the endpoint, like `sections.ts`, so the cap the client honours is the cap the server
 * enforces.
 */

/**
 * Upper bound on one reorder request.
 *
 * Not a product limit — `business_links` has none, and a tenant realistically has five to eight
 * sections. It exists so a single request can never turn into an unbounded row-by-row transaction:
 * the endpoint issues one UPDATE per id, and an unbounded array is an unbounded write. A profile
 * page with a hundred buttons is a different problem than ordering.
 */
export const MAX_ORDERED_SECTIONS = 100;

/**
 * The list with one item moved.
 *
 * Returns the *same array reference* when the move is a no-op — off either end, or onto itself — so
 * a caller can compare by identity and skip a pointless request to the server. That matters at the
 * ends of the list, where Move up on the first row is the commonest press that should do nothing.
 */
export function moveItem<T>(items: readonly T[], from: number, to: number): readonly T[] {
  if (!Number.isInteger(from) || !Number.isInteger(to)) return items;
  if (from === to) return items;
  if (from < 0 || from >= items.length) return items;
  if (to < 0 || to >= items.length) return items;

  const next = [...items];
  // Non-null: `from` was just bounds-checked against this array, which `splice` copied whole.
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return items;
  next.splice(to, 0, moved);
  return next;
}

/** Whether two id lists describe the same order. Used to decide if anything needs persisting. */
export function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((id, index) => id === b[index]);
}

/**
 * Whether two id lists contain the same ids, in any order.
 *
 * The reorder endpoint requires the complete set: a client that has not seen a section added or
 * removed elsewhere would otherwise silently reorder the sections it knows about and leave the rest
 * wherever they were. AC-021 makes the server the authority on order, so a stale client has to be
 * told to refresh rather than allowed to write a partial arrangement.
 */
export function sameMembers(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const seen = new Set(b);
  return a.every((id) => seen.has(id));
}

/** True when the list holds the same id twice — never legitimate, and it would collapse the order. */
export function hasDuplicates(ids: readonly string[]): boolean {
  return new Set(ids).size !== ids.length;
}

/**
 * The items rearranged into `ids`, keeping the item objects themselves.
 *
 * This is how a rejected reorder is rolled back: the screen returns to the order the server last
 * confirmed *without* discarding whatever else the owner has typed since. Anything the id list does
 * not mention keeps its relative position at the end, so a section added elsewhere cannot vanish from
 * the screen just because the stored order predates it.
 */
export function applyOrder<T extends { id: string }>(
  items: readonly T[],
  ids: readonly string[],
): readonly T[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const ordered: T[] = [];

  for (const id of ids) {
    const item = byId.get(id);
    if (item === undefined) continue;
    ordered.push(item);
    byId.delete(id);
  }

  return [...ordered, ...items.filter((item) => byId.has(item.id))];
}

/** The state of a pointer reorder as the gesture ends. */
export interface DragGesture {
  /** The row being dragged, or null when no drag is in flight. */
  dragIndex: number | null;
  /** Whether a real `drop` landed on the list during this gesture. */
  dropped: boolean;
}

export type DragEndResolution<T> =
  | { outcome: 'ignore' }
  | { outcome: 'commit'; order: readonly string[] }
  | { outcome: 'discard'; items: readonly T[] };

/**
 * What the end of a pointer reorder should do.
 *
 * `dragend` is not `drop`, and the two must not be treated as one. PROFILE-01 rearranges rows
 * optimistically on `dragenter` — four rows crossed is one gesture, not four writes — so when the
 * gesture ends the screen is already showing an arrangement nobody has committed. `dragend` fires
 * for an *abandoned* gesture too: Escape pressed mid-drag, or the pointer released outside the list.
 * AC-021 makes order server state, so persisting on `dragend` alone writes an arrangement the owner
 * explicitly walked away from.
 *
 *  - `commit` — a drop landed. The id order to post.
 *  - `discard` — the gesture was abandoned. The items put back in the order the server last
 *    confirmed, and nothing to post. Only positions move; anything typed mid-drag is kept, which is
 *    why this returns the item objects rather than fresh ones.
 *  - `ignore` — no drag was in flight, so `dragend` is not ours to answer.
 *
 * Pure and here rather than branching inside an event handler, because it is otherwise reachable
 * only by dragging with a real pointer — which is to say, never in a test.
 */
export function resolveDragEnd<T extends { id: string }>(
  gesture: DragGesture,
  items: readonly T[],
  storedOrder: readonly string[],
): DragEndResolution<T> {
  if (gesture.dragIndex === null) return { outcome: 'ignore' };

  if (gesture.dropped) {
    return { outcome: 'commit', order: items.map((item) => item.id) };
  }

  return { outcome: 'discard', items: applyOrder(items, storedOrder) };
}

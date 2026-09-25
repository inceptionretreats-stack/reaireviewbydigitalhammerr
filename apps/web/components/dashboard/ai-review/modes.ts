import { MODE_NAME_MAX } from '@/lib/ai/modes/schema';
import type { WireMode } from '@/lib/ai/modes/mode-service';

/**
 * Pure list operations for AI-02, kept out of the components so they can be tested.
 *
 * The types and limits are imported from the endpoint's own modules rather than restated. Both are
 * dependency-free TypeScript, `WireMode` is erased at build time, and the alternative — a second
 * declaration of the wire shape and a second copy of the 80-character cap — is how a client and its
 * API start disagreeing about what a mode is.
 *
 * Why the list is maintained from mutation responses instead of being refetched: every one of the
 * three endpoints returns the row it wrote, so applying that row is both fewer round trips and more
 * precise than a refetch, which would race with an edit the owner has already started typing.
 */

/**
 * Mirrors the ORDER BY in `listModes`: archived last, then oldest first, then id.
 *
 * The two must agree, or a row jumps position the moment it is edited. `created_at` is compared as
 * a string, which is safe because every value comes from `toISOString()` — one fixed-width UTC
 * format whose lexicographic order is its chronological order.
 */
export function sortModes(modes: readonly WireMode[]): WireMode[] {
  return [...modes].sort((a, b) => {
    if (a.is_archived !== b.is_archived) return a.is_archived ? 1 : -1;
    if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** Replaces a mode in place, or appends it when it is new, then restores the display order. */
export function mergeMode(modes: readonly WireMode[], updated: WireMode): WireMode[] {
  const known = modes.some((mode) => mode.id === updated.id);
  const next = known
    ? modes.map((mode) => (mode.id === updated.id ? updated : mode))
    : [...modes, updated];

  return sortModes(next);
}

/**
 * AI-02-01 expressed in client state: after an activation exactly one mode is in use, so every
 * other row is cleared rather than only the one the response named as previously active. That way a
 * list left stale by another tab cannot end up showing two modes in use.
 */
export function applyActivation(modes: readonly WireMode[], activated: WireMode): WireMode[] {
  const next = modes.map((mode) =>
    mode.id === activated.id ? activated : mode.is_active ? { ...mode, is_active: false } : mode,
  );

  return sortModes(next.some((mode) => mode.id === activated.id) ? next : [...next, activated]);
}

/**
 * A free name for the Duplicate action.
 *
 * Duplicate has no endpoint of its own — 08_OpenAPI_v1.yaml defines none — so it is a create
 * pre-filled from an existing mode, which means the client has to propose a name that will not
 * collide with `uq_review_mode_name`. Three details earn their place: the comparison is
 * case-insensitive because the constraint is not the only thing that matters (two modes called Food
 * and food are indistinguishable to the owner reading the list); an existing "copy" suffix is
 * stripped so duplicating a duplicate gives "Food copy 2" rather than "Food copy copy"; and the
 * base is truncated so the result still fits the 80-character column.
 *
 * The server remains authoritative — a name taken between this suggestion and the save comes back
 * as a 422 against the name field, which the form shows.
 */
export function duplicateNameFor(existingNames: readonly string[], base: string): string {
  const taken = new Set(existingNames.map((name) => name.trim().toLocaleLowerCase()));
  const stem = base.replace(/\s+copy(\s+\d+)?$/iu, '').trim() || base.trim();

  for (let attempt = 1; ; attempt += 1) {
    const suffix = attempt === 1 ? ' copy' : ` copy ${attempt}`;
    const candidate = `${stem.slice(0, MODE_NAME_MAX - suffix.length).trim()}${suffix}`;

    if (!taken.has(candidate.toLocaleLowerCase())) return candidate;

    // Unbounded in principle, bounded in practice: each attempt produces a distinct name and the
    // list is capped at MODE_LIST_LIMIT, so the loop cannot run longer than the list is long.
  }
}

/**
 * Narrows one mode out of a response payload.
 *
 * The endpoints are ours, but the client still validates rather than casts: a proxy error page, a
 * deploy mid-rollout or a truncated body would otherwise crash the screen with an unreadable
 * TypeError instead of showing the failure message the caller already has.
 */
export function asWireMode(value: unknown): WireMode | null {
  if (typeof value !== 'object' || value === null) return null;

  const row = value as Record<string, unknown>;

  if (typeof row.id !== 'string' || typeof row.name !== 'string') return null;
  if (typeof row.is_active !== 'boolean' || typeof row.is_archived !== 'boolean') return null;
  if (typeof row.created_at !== 'string' || typeof row.updated_at !== 'string') return null;
  if (!Array.isArray(row.context_terms)) return null;

  return {
    id: row.id,
    name: row.name,
    // The two optional-shaped fields degrade rather than reject the row: a description that is not
    // a string and a term that is not a string are cosmetic problems, and refusing the whole row
    // would hide a change that really was saved.
    description: typeof row.description === 'string' ? row.description : null,
    context_terms: row.context_terms.filter((term): term is string => typeof term === 'string'),
    is_active: row.is_active,
    is_archived: row.is_archived,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

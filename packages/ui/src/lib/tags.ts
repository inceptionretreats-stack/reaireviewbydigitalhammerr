/**
 * Tag list rules for `TagInput`.
 *
 * Framework-free and separately testable, mirroring the split used in `packages/core` — the
 * component owns the DOM, this owns the rules, and the rules can be exercised without a
 * renderer.
 *
 * The limits match the contract the server actually enforces
 * (`packages/contracts/src/business.ts`: `.max(30)` items of `.max(80)` characters, from
 * ONB-04 / AI-01 "Services/products tags (0-30)" and "Context terms (0-30)"). Duplicating them
 * client-side is a courtesy, never the authority: rejecting here keeps a business from typing
 * 31 terms and losing the lot on save, but the server still validates.
 */

export interface TagRules {
  maxItems: number;
  maxTagLength: number;
}

/** ONB-04 in `03_Screen_Field_Button_Spec.md`; mirrored by `aiContextRequest`. */
export const DEFAULT_TAG_RULES: TagRules = { maxItems: 30, maxTagLength: 80 };

export type TagRejection = 'EMPTY' | 'DUPLICATE' | 'TOO_LONG' | 'LIST_FULL';

export interface AddTagResult {
  tags: readonly string[];
  added: boolean;
  rejection: TagRejection | null;
}

/**
 * Trim and collapse internal whitespace. Business owners paste these out of menus and price
 * lists, so "wood  fired\npizza" and "wood fired pizza" must not become two distinct hints.
 */
export function normalizeTag(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

export function addTag(
  tags: readonly string[],
  raw: string,
  rules: TagRules = DEFAULT_TAG_RULES,
): AddTagResult {
  const value = normalizeTag(raw);

  if (value === '') return { tags, added: false, rejection: 'EMPTY' };
  if (value.length > rules.maxTagLength) return { tags, added: false, rejection: 'TOO_LONG' };

  // Case-insensitive duplicate check, but the casing the owner typed first is what is kept:
  // these terms are shown back to them and are fed to the model as written.
  const folded = value.toLocaleLowerCase();
  if (tags.some((tag) => tag.toLocaleLowerCase() === folded)) {
    return { tags, added: false, rejection: 'DUPLICATE' };
  }

  // Checked after the duplicate test on purpose: re-entering a term that is already in a full
  // list should read as "already added", not as "list full".
  if (tags.length >= rules.maxItems) return { tags, added: false, rejection: 'LIST_FULL' };

  return { tags: [...tags, value], added: true, rejection: null };
}

export function removeTagAt(tags: readonly string[], index: number): readonly string[] {
  if (index < 0 || index >= tags.length) return tags;
  return [...tags.slice(0, index), ...tags.slice(index + 1)];
}

/**
 * Splits one pasted or typed chunk into candidate tags on commas and newlines.
 *
 * Tabs are included because pasting a column out of a spreadsheet is the common case; a plain
 * space is not, because multi-word terms ("wood fired pizza") are the point of the field.
 */
export function splitTagInput(raw: string): readonly string[] {
  return raw
    .split(/[,\n\r\t]/)
    .map(normalizeTag)
    .filter((value) => value !== '');
}

/** Applies `addTag` across a pasted chunk, reporting whichever rejection stopped the last one. */
export function addTags(
  tags: readonly string[],
  raw: string,
  rules: TagRules = DEFAULT_TAG_RULES,
): AddTagResult {
  let current = tags;
  let added = false;
  let rejection: TagRejection | null = null;

  for (const candidate of splitTagInput(raw)) {
    const result = addTag(current, candidate, rules);
    current = result.tags;
    added = added || result.added;
    // A rejection is only worth surfacing if nothing after it succeeded, which the caller can
    // tell from `added`; keeping the last one gives the most useful single message.
    if (result.rejection !== null) rejection = result.rejection;
  }

  return { tags: current, added, rejection };
}

export function describeTagRejection(rejection: TagRejection, rules: TagRules): string {
  switch (rejection) {
    case 'EMPTY':
      return 'Type a term before adding it.';
    case 'DUPLICATE':
      return 'That term is already in the list.';
    case 'TOO_LONG':
      return `Keep each term under ${rules.maxTagLength} characters.`;
    case 'LIST_FULL':
      return `You can add up to ${rules.maxItems} terms. Remove one to add another.`;
  }
}

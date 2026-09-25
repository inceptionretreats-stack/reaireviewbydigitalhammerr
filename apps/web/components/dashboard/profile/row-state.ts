import type { BadgeTone } from '@ai-review/ui';
import {
  hasStoredTarget,
  rendersPublicly,
  sectionTarget,
  type SectionType,
} from '@/lib/profile/sections';

/**
 * How one section describes itself on PROFILE-01.
 *
 * Split out of the row component and kept pure for two reasons. It is the screen's answer to AC-020
 * — a section that is disabled or has no target produces no button at all, and the owner has to be
 * able to see that from the list rather than by loading their public page — so it is worth a test
 * that fails if the two ever disagree. And every state here is a *word*, never a colour: the badge
 * tone is decoration on top of a sentence, which is what AC-038 and the design brief's "never
 * convey state by colour alone" require.
 *
 * The badge always describes what a visitor sees *now*, from the stored values. Unsaved edits are
 * reported separately by `describePendingChange`, because a badge that flips as soon as a toggle
 * moves would claim a page has changed when nothing has been written yet.
 */

export interface SectionSnapshot {
  type: SectionType;
  label: string;
  url: string | null;
  phone: string | null;
  enabled: boolean;
}

export interface SectionRowPresentation {
  tone: BadgeTone;
  /** Carries the meaning on its own. */
  label: string;
}

/**
 * One row's editing state: what is on screen, and what the server last confirmed.
 *
 * `url` and `phone` are plain strings rather than `string | null` because they are what an `<input>`
 * holds, and a controlled input whose value goes null warns and then loses the cursor. The empty
 * string is the absent value throughout, and `sectionPatch` is where it becomes the NULL the endpoint
 * stores.
 */
export interface EditorSection {
  id: string;
  type: SectionType;
  label: string;
  url: string;
  phone: string;
  enabled: boolean;
  stored: { label: string; url: string; phone: string; enabled: boolean };
}

/** One edit from the row's controls: a target, the button text, or the Hide/Show switch. */
export type SectionEdit = Partial<Pick<EditorSection, 'label' | 'url' | 'phone' | 'enabled'>>;

/**
 * Applies one edit, keeping visibility consistent with whether there is anything to point at.
 *
 * This is PROFILE-01-02 handled where the owner can see it, rather than as a refusal after the fact.
 * Filling a blank target switches the section on, because a section with no target cannot have been
 * switched off deliberately — `ck_enabled_link_has_target` means "off" was its only possible state,
 * and ONB-03 enables a section the same way the moment it has a target. Clearing the target switches
 * it back off, which is what the endpoint would do anyway; doing it here means the owner reads it as a
 * consequence of their own edit instead of as something the save did to them.
 *
 * An explicit Hide/Show press is never overridden: that branch only runs when the edit did not touch
 * `enabled`. GOOGLE_REVIEW always reports a target of its own (AMENDMENT-003), so neither branch ever
 * moves its switch.
 */
export function applyEdit(section: EditorSection, edit: SectionEdit): EditorSection {
  const next = { ...section, ...edit };
  if (edit.enabled !== undefined) return next;

  const had = hasStoredTarget(currentOf(section));
  const has = hasStoredTarget(currentOf(next));

  if (!had && has) return { ...next, enabled: true };
  if (had && !has) return { ...next, enabled: false };
  return next;
}

export function currentOf(section: EditorSection): SectionSnapshot {
  const { type, label, url, phone, enabled } = section;
  return { type, label, url, phone, enabled };
}

export function storedOf(section: EditorSection): SectionSnapshot {
  return { type: section.type, ...section.stored };
}

export function describeSectionRow(
  stored: SectionSnapshot,
  reviewUrl: string | null,
): SectionRowPresentation {
  if (rendersPublicly(stored, reviewUrl)) {
    return { tone: 'success', label: 'Shows on your page' };
  }

  // AMENDMENT-003: the Review Us button opens the destination in review_destinations, so without one
  // it has nothing to open and the public page omits it however this row is set. Distinguished from
  // an ordinary hidden section because the fix is on another screen.
  if (stored.type === 'GOOGLE_REVIEW' && stored.enabled) {
    return { tone: 'warning', label: 'Needs your Google link' };
  }

  if (!stored.enabled) {
    return { tone: 'neutral', label: 'Hidden, so no button' };
  }

  // Enabled with nothing to point at. Reachable for a row written before
  // ck_enabled_link_has_target existed, or by a seed; the endpoints will not create one.
  return { tone: 'neutral', label: 'No link yet, so no button' };
}

/**
 * What the owner's unsaved edits will do, in a sentence, or null when there is nothing pending.
 *
 * Whether the button appears or disappears is the part worth spelling out — a section they have just
 * switched off is still on their live page until Save, and that is exactly the sort of thing an owner
 * assumes went through.
 */
export function describePendingChange(
  current: SectionSnapshot,
  stored: SectionSnapshot,
  reviewUrl: string | null,
): string | null {
  if (!isDirty(current, stored)) return null;

  const willShow = rendersPublicly(current, reviewUrl);
  const shows = rendersPublicly(stored, reviewUrl);

  if (willShow && !shows) return 'This button will start showing when you save.';
  if (!willShow && shows) return 'This button will stop showing when you save.';
  return 'Not saved yet.';
}

export function isDirty(current: SectionSnapshot, stored: SectionSnapshot): boolean {
  return (
    current.label !== stored.label ||
    current.enabled !== stored.enabled ||
    blank(current.url) !== blank(stored.url) ||
    blank(current.phone) !== blank(stored.phone)
  );
}

/**
 * The changes to send for this section, or null when there are none.
 *
 * Only what changed is sent. A patch that restates every field would make an untouched WhatsApp
 * number get re-normalised and re-written on every save, and would turn a validation error on one
 * field into a refusal to save the field the owner actually edited.
 */
export function sectionPatch(
  current: SectionSnapshot,
  stored: SectionSnapshot,
): Record<string, unknown> | null {
  const patch: Record<string, unknown> = {};

  if (current.label !== stored.label) patch.label = current.label;
  if (current.enabled !== stored.enabled) patch.enabled = current.enabled;

  // GOOGLE_REVIEW has no target of its own to send (AMENDMENT-003, ck_google_review_has_no_url), and
  // the endpoint refuses one — so the key is never included for it.
  const target = sectionTarget(current.type);
  if (target === 'url' && blank(current.url) !== blank(stored.url)) {
    patch.url = blank(current.url);
  }
  if (target === 'phone' && blank(current.phone) !== blank(stored.phone)) {
    patch.phone = blank(current.phone);
  }

  return Object.keys(patch).length === 0 ? null : patch;
}

/**
 * Adds the scheme an owner pasting "instagram.com/mycafe" left off.
 *
 * Same helper as `LinksStep`'s, and same rule: a value that already carries a scheme is never
 * touched. Promoting http:// to https:// silently would change where the button points, which is not
 * a formatting fix — and the endpoint refusing it is the honest outcome.
 */
export function withHttps(value: string): string {
  const trimmed = value.trim().replace(/^\/+/, '');
  if (trimmed.length === 0) return '';
  if (/^[a-z][a-z\d+.-]*:/i.test(trimmed)) return trimmed;
  return trimmed.includes('.') ? `https://${trimmed}` : trimmed;
}

/** An empty box means "no target", which the endpoint stores as NULL. */
function blank(value: string | null): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed.length === 0 ? null : trimmed;
}

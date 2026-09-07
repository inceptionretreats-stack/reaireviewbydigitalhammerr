import { describe, expect, it } from 'vitest';
import {
  applyEdit,
  describePendingChange,
  describeSectionRow,
  isDirty,
  sectionPatch,
  withHttps,
  type EditorSection,
  type SectionSnapshot,
} from '../row-state';

/**
 * What one section says about itself, and what it sends when saved.
 *
 * `sectionPatch` is the interesting one: it is what stops PROFILE-01 posting a url for the Review Us
 * button (AMENDMENT-003 — `review_destinations` owns that URL, and `ck_google_review_has_no_url`
 * would refuse it), and what keeps a save down to the fields the owner actually changed.
 */

function snapshot(over: Partial<SectionSnapshot> = {}): SectionSnapshot {
  return { type: 'INSTAGRAM', label: 'Instagram', url: null, phone: null, enabled: false, ...over };
}

const GOOGLE_URL = 'https://maps.google.com/place';

describe('describeSectionRow', () => {
  it('says a live section shows, in words rather than by colour', () => {
    const state = describeSectionRow(
      snapshot({ url: 'https://instagram.com/cafe', enabled: true }),
      null,
    );
    expect(state.label).toBe('Shows on your page');
    expect(state.tone).toBe('success');
  });

  it('separates a Review Us button with no destination from an ordinary hidden one', () => {
    const state = describeSectionRow(snapshot({ type: 'GOOGLE_REVIEW', enabled: true }), null);
    expect(state.label).toBe('Needs your Google link');
  });

  it('says a hidden section produces no button at all (AC-020)', () => {
    const state = describeSectionRow(snapshot({ url: 'https://instagram.com/cafe' }), null);
    expect(state.label).toBe('Hidden, so no button');
  });

  it('says an enabled section with no link produces no button either', () => {
    expect(describeSectionRow(snapshot({ enabled: true }), null).label).toBe(
      'No link yet, so no button',
    );
  });
});

describe('describePendingChange', () => {
  const stored = snapshot({ url: 'https://instagram.com/cafe', enabled: true });

  it('says nothing when nothing has changed', () => {
    expect(describePendingChange(stored, stored, null)).toBeNull();
  });

  it('warns that a button is still live until the owner saves', () => {
    const current = { ...stored, enabled: false };
    expect(describePendingChange(current, stored, null)).toBe(
      'This button will stop showing when you save.',
    );
  });

  it('says a newly filled section will appear once saved', () => {
    const empty = snapshot({ enabled: false });
    const filled = snapshot({ url: 'https://instagram.com/cafe', enabled: true });
    expect(describePendingChange(filled, empty, null)).toBe(
      'This button will start showing when you save.',
    );
  });

  it('still reports an edit that does not change whether the button appears', () => {
    const current = { ...stored, label: 'Follow us' };
    expect(describePendingChange(current, stored, null)).toBe('Not saved yet.');
  });
});

describe('isDirty', () => {
  it('treats an empty box and a cleared target as the same thing', () => {
    const stored = snapshot({ url: null });
    expect(isDirty(snapshot({ url: '' }), stored)).toBe(false);
    expect(isDirty(snapshot({ url: '   ' }), stored)).toBe(false);
    expect(isDirty(snapshot({ url: 'https://instagram.com/cafe' }), stored)).toBe(true);
  });

  it('notices a renamed button and a flipped switch', () => {
    const stored = snapshot();
    expect(isDirty(snapshot({ label: 'Follow us' }), stored)).toBe(true);
    expect(isDirty(snapshot({ enabled: true }), stored)).toBe(true);
  });
});

describe('sectionPatch', () => {
  it('sends nothing when nothing changed', () => {
    const stored = snapshot({ url: 'https://instagram.com/cafe', enabled: true });
    expect(sectionPatch({ ...stored }, stored)).toBeNull();
  });

  it('sends only the field that changed', () => {
    const stored = snapshot({ url: 'https://instagram.com/cafe', enabled: true });
    expect(sectionPatch({ ...stored, label: 'Follow us' }, stored)).toEqual({ label: 'Follow us' });
  });

  it('clears a target as null, which is what the endpoint stores', () => {
    const stored = snapshot({ url: 'https://instagram.com/cafe', enabled: true });
    expect(sectionPatch({ ...stored, url: '' }, stored)).toEqual({ url: null });
  });

  it('trims a pasted target rather than storing the whitespace', () => {
    const stored = snapshot();
    expect(sectionPatch({ ...stored, url: '  https://instagram.com/cafe  ' }, stored)).toEqual({
      url: 'https://instagram.com/cafe',
    });
  });

  it('sends a phone for a dialling section and never a url', () => {
    const stored = snapshot({ type: 'WHATSAPP', label: 'WhatsApp' });
    const current = { ...stored, phone: '9876543210', url: 'https://wa.me/919876543210' };
    expect(sectionPatch(current, stored)).toEqual({ phone: '9876543210' });
  });

  /**
   * The AMENDMENT-003 guard. The endpoint refuses a url on this row and the database check would too;
   * this is what stops the screen sending one in the first place.
   */
  it('never sends a url for Review Us, even if one is somehow on the row', () => {
    const stored = snapshot({ type: 'GOOGLE_REVIEW', label: 'Review Us', enabled: true });
    const current = { ...stored, url: GOOGLE_URL };
    expect(sectionPatch(current, stored)).toBeNull();
  });

  it('still sends the button text and visibility for Review Us', () => {
    const stored = snapshot({ type: 'GOOGLE_REVIEW', label: 'Review Us', enabled: true });
    expect(sectionPatch({ ...stored, label: 'Leave a review', enabled: false }, stored)).toEqual({
      label: 'Leave a review',
      enabled: false,
    });
  });
});

describe('applyEdit — PROFILE-01-02 as the owner experiences it', () => {
  function row(over: Partial<EditorSection> = {}): EditorSection {
    const stored = { label: 'Instagram', url: '', phone: '', enabled: false };
    return { id: 'row-1', type: 'INSTAGRAM', ...stored, stored, ...over };
  }

  it('switches a section on as soon as it has somewhere to point', () => {
    const next = applyEdit(row(), { url: 'https://instagram.com/cafe' });
    expect(next.enabled).toBe(true);
  });

  it('switches a section off when its target is cleared', () => {
    const filled = row({ url: 'https://instagram.com/cafe', enabled: true });
    expect(applyEdit(filled, { url: '' }).enabled).toBe(false);
  });

  it('never overrides an explicit Hide or Show press', () => {
    const filled = row({ url: 'https://instagram.com/cafe', enabled: true });
    expect(applyEdit(filled, { enabled: false }).enabled).toBe(false);

    const blank = row();
    // The row disables the switch in this state, so this is the belt to that braces: an explicit
    // request is passed through unchanged and the endpoint is what refuses it.
    expect(applyEdit(blank, { enabled: true }).enabled).toBe(true);
  });

  it('leaves the Review Us switch alone, since its destination is not on the row', () => {
    const reviewUs = row({ type: 'GOOGLE_REVIEW', label: 'Review Us', enabled: false });
    expect(applyEdit(reviewUs, { label: 'Leave a review' }).enabled).toBe(false);
  });

  it('does not touch visibility for an edit that only renames the button', () => {
    const filled = row({ url: 'https://instagram.com/cafe', enabled: true });
    expect(applyEdit(filled, { label: 'Follow us' })).toMatchObject({
      label: 'Follow us',
      enabled: true,
    });
  });
});

describe('withHttps', () => {
  it('adds the scheme an owner left off', () => {
    expect(withHttps('instagram.com/cafe')).toBe('https://instagram.com/cafe');
  });

  it('never rewrites a scheme that is already there', () => {
    expect(withHttps('http://example.com')).toBe('http://example.com');
    expect(withHttps('https://example.com')).toBe('https://example.com');
  });

  it('leaves something that is not a host alone, so the error names the real problem', () => {
    expect(withHttps('my page')).toBe('my page');
    expect(withHttps('')).toBe('');
    expect(withHttps('   ')).toBe('');
  });
});

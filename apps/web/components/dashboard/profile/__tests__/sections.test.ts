import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SECTION_TYPES,
  SECTION,
  SECTION_TYPES,
  hasStoredTarget,
  isDefaultSectionType,
  isSectionType,
  rendersPublicly,
  type SectionType,
} from '../sections';

/**
 * The section vocabulary shared by PROFILE-01 and its two endpoints.
 *
 * These assertions pin the two facts the screen would otherwise be free to get wrong: that
 * GOOGLE_REVIEW is the only section with no target of its own (AMENDMENT-003), and that "would a
 * visitor see this" is answered the same way the public page answers it (AC-020).
 */

function section(over: Partial<{ type: SectionType; url: string | null; phone: string | null }>) {
  return { type: 'INSTAGRAM' as SectionType, url: null, phone: null, ...over };
}

describe('the section catalogue', () => {
  it('describes every link type the database can store', () => {
    for (const type of SECTION_TYPES) {
      expect(SECTION[type].name.length).toBeGreaterThan(0);
    }
  });

  it('gives every section except Review Us a target input to fill in', () => {
    for (const type of SECTION_TYPES) {
      const descriptor = SECTION[type];
      if (descriptor.target === 'none') continue;
      expect(descriptor.targetLabel.length).toBeGreaterThan(0);
      expect(descriptor.hint.length).toBeGreaterThan(0);
    }
  });

  it('leaves GOOGLE_REVIEW as the only section with no target of its own (AMENDMENT-003)', () => {
    const withoutTarget = SECTION_TYPES.filter((type) => SECTION[type].target === 'none');
    expect(withoutTarget).toEqual(['GOOGLE_REVIEW']);
  });

  it('lists the D-014 defaults in the order the Decision Log gives them', () => {
    expect(DEFAULT_SECTION_TYPES).toEqual([
      'GOOGLE_REVIEW',
      'WHATSAPP',
      'CALL',
      'INSTAGRAM',
      'FACEBOOK',
    ]);
  });

  it('treats the added types as removable and the defaults as not', () => {
    expect(isDefaultSectionType('WHATSAPP')).toBe(true);
    expect(isDefaultSectionType('WEBSITE')).toBe(false);
    expect(isDefaultSectionType('CUSTOM')).toBe(false);
  });

  it('rejects a type the enum does not have', () => {
    expect(isSectionType('GOOGLE_REVIEW')).toBe(true);
    expect(isSectionType('MASTODON')).toBe(false);
    expect(isSectionType('')).toBe(false);
  });
});

describe('hasStoredTarget — the ck_enabled_link_has_target condition', () => {
  it('counts Review Us as targeted, because its destination is not on the row', () => {
    expect(hasStoredTarget(section({ type: 'GOOGLE_REVIEW' }))).toBe(true);
  });

  it('needs a phone for a dialling section', () => {
    expect(hasStoredTarget(section({ type: 'CALL', phone: '+919876543210' }))).toBe(true);
    expect(hasStoredTarget(section({ type: 'CALL', phone: '' }))).toBe(false);
    expect(hasStoredTarget(section({ type: 'CALL', phone: '   ' }))).toBe(false);
    expect(hasStoredTarget(section({ type: 'CALL' }))).toBe(false);
  });

  it('needs a url for a linking section', () => {
    expect(hasStoredTarget(section({ url: 'https://instagram.com/cafe' }))).toBe(true);
    expect(hasStoredTarget(section({ url: '' }))).toBe(false);
  });
});

describe('rendersPublicly — the editor mirror of AC-020', () => {
  it('shows nothing for a hidden section, however well configured', () => {
    expect(
      rendersPublicly(
        { ...section({ url: 'https://instagram.com/cafe' }), enabled: false },
        'https://maps.google.com/x',
      ),
    ).toBe(false);
  });

  it('drops Review Us until a Google destination exists (AMENDMENT-003, AC-017)', () => {
    const reviewUs = { ...section({ type: 'GOOGLE_REVIEW' }), enabled: true };
    expect(rendersPublicly(reviewUs, null)).toBe(false);
    expect(rendersPublicly(reviewUs, '   ')).toBe(false);
    expect(rendersPublicly(reviewUs, 'https://maps.google.com/x')).toBe(true);
  });

  it('drops an enabled section that has nothing to point at', () => {
    expect(rendersPublicly({ ...section({ url: '' }), enabled: true }, null)).toBe(false);
    expect(rendersPublicly({ ...section({ type: 'WHATSAPP' }), enabled: true }, null)).toBe(false);
  });

  it('shows an enabled section with a target', () => {
    expect(
      rendersPublicly(
        { ...section({ type: 'WHATSAPP', phone: '+919876543210' }), enabled: true },
        null,
      ),
    ).toBe(true);
  });

  it('ignores a url on CALL, which the public page resolves from the phone alone', () => {
    expect(
      rendersPublicly(
        { ...section({ type: 'CALL', url: 'https://example.com' }), enabled: true },
        null,
      ),
    ).toBe(false);
  });

  /**
   * The one dialling section with a second way to resolve. `resolveTarget` in `app/[slug]/page.tsx`
   * reads WHATSAPP as `whatsAppHref(link.phone) ?? externalHref(link.url)`, so a row carrying only a
   * pasted wa.me link renders a live button. Reporting it as "no button" here would drop it from the
   * preview and label it "No link yet" while a visitor was tapping it (AC-020).
   */
  it('accepts a url on WHATSAPP, which the public page falls back to when there is no phone', () => {
    expect(
      rendersPublicly(
        { ...section({ type: 'WHATSAPP', url: 'https://wa.me/919876543210' }), enabled: true },
        null,
      ),
    ).toBe(true);
  });

  it('still needs one of the two on WHATSAPP', () => {
    expect(
      rendersPublicly({ ...section({ type: 'WHATSAPP', url: '  ' }), enabled: true }, null),
    ).toBe(false);
  });
});

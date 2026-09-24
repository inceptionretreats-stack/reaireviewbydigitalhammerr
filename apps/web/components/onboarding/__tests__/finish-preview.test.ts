import { describe, expect, it } from 'vitest';
import { SHELL_CATEGORY, isShell } from '@/lib/tenant/tenant-shell';
import {
  asStringArray,
  buildPreviewSections,
  derivePublishBlockers,
  describeBlocker,
  hasTarget,
  humanizeKey,
  previewDraft,
  readPublication,
  readRefusal,
  showsOnlyDefaultSections,
  type PreviewLinkRow,
  type PublishReadiness,
} from '../finish-preview';

/**
 * ONB-05 previews and blockers.
 *
 * Two of these suites exist because the screen previously told owners something untrue: the
 * blocker list was derived from `loadOnboardingProgress.hasBusinessDetails` (a different predicate
 * from the publish endpoint's), and the "Only Review Us will show" line rendered even when the
 * preview showed no Review Us row at all. Both are pinned below.
 */

function link(over: Partial<PreviewLinkRow> = {}): PreviewLinkRow {
  return { id: 'l1', linkType: 'WHATSAPP', label: 'WhatsApp', url: null, phone: null, ...over };
}

function readiness(over: Partial<PublishReadiness> = {}): PublishReadiness {
  return {
    name: 'Demo South Cafe',
    category: 'Restaurant',
    hasPrimarySlug: true,
    hasReviewDestination: true,
    ...over,
  };
}

describe('derivePublishBlockers', () => {
  it('lists nothing when the three publish prerequisites are met', () => {
    expect(derivePublishBlockers(readiness())).toEqual([]);
  });

  // The regression this file exists for. `loadOnboardingProgress.hasBusinessDetails` also requires
  // a non-empty city, and businessIdentityRequest permits an empty one, so a tenant could be shown
  // "Your business name, category and city" while publish had nothing to refuse.
  it('has nothing to refuse for a tenant with no city — publish tests name and category only', () => {
    const cityless = { name: 'Demo South Cafe', category: 'Restaurant', city: '' };
    expect(isShell(cityless.name, cityless.category)).toBe(false);
    expect(
      derivePublishBlockers({
        name: cityless.name,
        category: cityless.category,
        hasPrimarySlug: true,
        hasReviewDestination: true,
      }),
    ).toEqual([]);
  });

  it('names web_address, not business_details, when only the slug is missing', () => {
    expect(derivePublishBlockers(readiness({ hasPrimarySlug: false }))).toEqual(['web_address']);
  });

  it('names business_details while the signup placeholders are still in place', () => {
    expect(derivePublishBlockers(readiness({ category: SHELL_CATEGORY }))).toEqual([
      'business_details',
    ]);
    expect(derivePublishBlockers(readiness({ name: '   ' }))).toEqual(['business_details']);
  });

  it('names google_review_link on its own — the one non-negotiable prerequisite', () => {
    expect(derivePublishBlockers(readiness({ hasReviewDestination: false }))).toEqual([
      'google_review_link',
    ]);
  });

  it('reports all three in the endpoint order for an untouched shell', () => {
    expect(
      derivePublishBlockers({
        name: 'Asha Sharma',
        category: SHELL_CATEGORY,
        hasPrimarySlug: false,
        hasReviewDestination: false,
      }),
    ).toEqual(['business_details', 'web_address', 'google_review_link']);
  });

  it('only ever emits keys the screen can label', () => {
    const keys = derivePublishBlockers({
      name: '',
      category: SHELL_CATEGORY,
      hasPrimarySlug: false,
      hasReviewDestination: false,
    });
    for (const key of keys) expect(describeBlocker(key).step).not.toBeNull();
  });
});

describe('hasTarget', () => {
  // AMENDMENT-003: review_destinations owns the URL, so the GOOGLE_REVIEW link row has none.
  it('resolves GOOGLE_REVIEW from the destination, never from its own url', () => {
    const row = link({ linkType: 'GOOGLE_REVIEW', label: 'Review Us' });
    expect(hasTarget(row, true)).toBe(true);
    expect(hasTarget(row, false)).toBe(false);
    // Even a url that somehow got stored on the row does not make it renderable.
    expect(hasTarget({ ...row, url: 'https://g.page/x' }, false)).toBe(false);
  });

  it('accepts a url or a phone, and treats whitespace as absent', () => {
    expect(hasTarget(link({ url: 'https://wa.me/91' }), false)).toBe(true);
    expect(hasTarget(link({ phone: '+919876543210' }), false)).toBe(true);
    expect(hasTarget(link({ url: '   ' }), false)).toBe(false);
    expect(hasTarget(link({ url: '', phone: '' }), false)).toBe(false);
    expect(hasTarget(link(), false)).toBe(false);
  });
});

describe('buildPreviewSections', () => {
  it('drops a GOOGLE_REVIEW row when no destination is saved (AC-020)', () => {
    const sections = buildPreviewSections(
      [link({ id: 'g', linkType: 'GOOGLE_REVIEW', label: 'Review Us' })],
      false,
    );
    expect(sections).toEqual([]);
  });

  it('drops a targetless section rather than showing it disabled', () => {
    const sections = buildPreviewSections(
      [link({ id: 'a', label: 'Call us' }), link({ id: 'b', label: 'WhatsApp', phone: '+9198' })],
      false,
    );
    expect(sections.map((section) => section.id)).toEqual(['b']);
  });

  it('adds the synthetic primary publish will create for a tenant with no link rows', () => {
    expect(buildPreviewSections([], true)).toEqual([
      { id: 'default-google-review', label: 'Review Us', isPrimary: true },
    ]);
  });

  it('puts the synthetic primary first, ahead of the owner ordered sections', () => {
    const sections = buildPreviewSections([link({ id: 'a', url: 'https://example.com' })], true);
    expect(sections.map((section) => section.id)).toEqual(['default-google-review', 'a']);
  });

  it('does not add a second primary when the tenant already has a GOOGLE_REVIEW row', () => {
    const sections = buildPreviewSections(
      [link({ id: 'g', linkType: 'GOOGLE_REVIEW', label: 'Rate us on Google' })],
      true,
    );
    expect(sections).toEqual([{ id: 'g', label: 'Rate us on Google', isPrimary: true }]);
  });

  it('preserves the order it is given, which is the owner order (D-015, AC-021)', () => {
    const sections = buildPreviewSections(
      [
        link({ id: 'a', label: 'Website', url: 'https://a.example' }),
        link({ id: 'b', label: 'Call', phone: '+9198' }),
        link({ id: 'c', label: 'Menu', url: 'https://c.example' }),
      ],
      false,
    );
    expect(sections.map((section) => section.label)).toEqual(['Website', 'Call', 'Menu']);
  });
});

describe('showsOnlyDefaultSections', () => {
  // The regression: with no destination and no targeted links the preview box is empty, so
  // "Only Review Us and private feedback will show" would have promised a button nothing showed.
  it('is false for an empty preview, where the blocker card already speaks', () => {
    expect(showsOnlyDefaultSections(buildPreviewSections([], false))).toBe(false);
  });

  it('is true when the Review Us row is the only section', () => {
    expect(showsOnlyDefaultSections(buildPreviewSections([], true))).toBe(true);
  });

  it('is false once the owner has added a section of their own', () => {
    const sections = buildPreviewSections([link({ id: 'a', url: 'https://a.example' })], true);
    expect(showsOnlyDefaultSections(sections)).toBe(false);
  });
});

describe('asStringArray', () => {
  it('returns an empty array for anything jsonb might hold other than an array', () => {
    expect(asStringArray(null)).toEqual([]);
    expect(asStringArray(undefined)).toEqual([]);
    expect(asStringArray('filter coffee')).toEqual([]);
    expect(asStringArray({ terms: ['a'] })).toEqual([]);
    expect(asStringArray(7)).toEqual([]);
  });

  it('keeps only the string entries of an array', () => {
    expect(asStringArray(['filter coffee', 3, null, 'dosa', { a: 1 }])).toEqual([
      'filter coffee',
      'dosa',
    ]);
  });
});

describe('describeBlocker', () => {
  it('labels every requirement the endpoint can name and points at its step', () => {
    expect(describeBlocker('business_details')).toEqual({
      key: 'business_details',
      label: 'Your business name, category and city',
      step: 'business',
    });
    expect(describeBlocker('web_address').step).toBe('business');
    expect(describeBlocker('google_review_link').step).toBe('review-link');
  });

  it('never leaves an unknown key as a dead end', () => {
    expect(describeBlocker('billing_address')).toEqual({
      key: 'billing_address',
      label: 'Billing address',
      step: null,
    });
  });

  it('falls back to a sentence rather than an empty label', () => {
    expect(humanizeKey('')).toBe('One more detail');
    expect(humanizeKey('__')).toBe('One more detail');
    expect(humanizeKey('web_address')).toBe('Web address');
  });
});

describe('readRefusal', () => {
  it('shows the message the API sent and keeps details.missing', () => {
    expect(
      readRefusal({
        error: {
          code: 'BUSINESS_NOT_ACTIVE',
          message: 'A few things are still needed before you can publish.',
          details: { missing: ['web_address'] },
        },
      }),
    ).toEqual({
      message: 'A few things are still needed before you can publish.',
      missing: ['web_address'],
    });
  });

  it('falls back safely for a payload that is not an error envelope', () => {
    const fallback = { message: 'Something went wrong. Please try again.', missing: null };
    expect(readRefusal(null)).toEqual(fallback);
    expect(readRefusal('<html>502</html>')).toEqual(fallback);
    expect(readRefusal({})).toEqual(fallback);
    // A null or non-object `error` must not throw on the way to the fallback.
    expect(readRefusal({ error: null })).toEqual(fallback);
    expect(readRefusal({ error: 'boom' })).toEqual(fallback);
    expect(readRefusal({ error: { code: 'X' } })).toEqual(fallback);
  });

  it('reports no missing keys when the envelope carries none it can use', () => {
    expect(readRefusal({ error: { message: 'Too many requests.' } }).missing).toBeNull();
    expect(readRefusal({ error: { message: 'x', details: 'nope' } }).missing).toBeNull();
    expect(
      readRefusal({ error: { message: 'x', details: { missing: 'web_address' } } }).missing,
    ).toBeNull();
  });

  it('keeps only the string entries of details.missing', () => {
    expect(
      readRefusal({ error: { message: 'x', details: { missing: ['web_address', 7, null] } } })
        .missing,
    ).toEqual(['web_address']);
  });
});

describe('readPublication', () => {
  it('reads the address and the printed code the endpoint returns', () => {
    expect(readPublication({ public_url: 'https://ai.example/demo', qr_code: 'ABCD1234' })).toEqual(
      { publicUrl: 'https://ai.example/demo', qrCode: 'ABCD1234' },
    );
  });

  it('never invents a value from a payload that does not carry one', () => {
    const empty = { publicUrl: null, qrCode: null };
    expect(readPublication({})).toEqual(empty);
    expect(readPublication(null)).toEqual(empty);
    expect(readPublication('ok')).toEqual(empty);
    expect(readPublication({ public_url: 7, qr_code: { code: 'x' } })).toEqual(empty);
  });
});

describe('previewDraft', () => {
  it('shows a trimmed draft only on success', () => {
    expect(
      previewDraft({ status: 'success', payload: { review_text: '  Lovely filter coffee. ' } }),
    ).toBe('Lovely filter coffee.');
    expect(previewDraft({ status: 'idle' })).toBeNull();
    expect(previewDraft({ status: 'submitting' })).toBeNull();
    expect(
      previewDraft({
        status: 'error',
        failure: { code: 'AI_UNAVAILABLE', message: 'Try again in a moment.', fields: [] },
      }),
    ).toBeNull();
  });

  it('treats a blank or non-string draft as nothing to show', () => {
    expect(previewDraft({ status: 'success', payload: {} })).toBeNull();
    expect(previewDraft({ status: 'success', payload: { review_text: '   ' } })).toBeNull();
    expect(previewDraft({ status: 'success', payload: { review_text: 42 } })).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { normalizeSlug, suggestSlugs, validateSlug } from '../slug';
import { normalizeGoogleReviewUrl, validateGoogleReviewUrl } from '../review-url';
import { buildWhatsAppLink, normalizePhone } from '../phone';

describe('slug', () => {
  it('normalizes a business name into slug form', () => {
    expect(normalizeSlug('Demo South Cafe')).toBe('demo-south-cafe');
    expect(normalizeSlug('  Sharma & Sons!  ')).toBe('sharma-sons');
    expect(normalizeSlug('Cafe   Mocha')).toBe('cafe-mocha');
  });

  it('strips diacritics rather than turning them into hyphens', () => {
    expect(normalizeSlug('Café Böhm')).toBe('cafe-bohm');
  });

  it('accepts a well-formed slug', () => {
    expect(validateSlug('demo-south-cafe')).toEqual({ ok: true, slug: 'demo-south-cafe' });
  });

  it('compares case-insensitively (ONB-01-01)', () => {
    expect(validateSlug('Demo-South-Cafe')).toEqual({ ok: true, slug: 'demo-south-cafe' });
  });

  /** /r/ is the dynamic QR namespace (ADR-002); a business taking it would shadow every QR. */
  it('refuses reserved platform routes', () => {
    expect(validateSlug('r')).toMatchObject({ ok: false, reason: 'RESERVED' });
    expect(validateSlug('admin')).toMatchObject({ ok: false, reason: 'RESERVED' });
    expect(validateSlug('api')).toMatchObject({ ok: false, reason: 'RESERVED' });
  });

  it('refuses malformed shapes', () => {
    expect(validateSlug('ab')).toMatchObject({ reason: 'TOO_SHORT' });
    expect(validateSlug('a'.repeat(49))).toMatchObject({ reason: 'TOO_LONG' });
    expect(validateSlug('cafe_mocha')).toMatchObject({ reason: 'INVALID_CHARACTERS' });
    expect(validateSlug('-cafe')).toMatchObject({ reason: 'LEADING_OR_TRAILING_HYPHEN' });
    expect(validateSlug('cafe--mocha')).toMatchObject({ reason: 'CONSECUTIVE_HYPHENS' });
    expect(validateSlug('12345')).toMatchObject({ reason: 'NUMERIC_ONLY' });
  });

  it('suggests valid alternatives when a slug is taken', () => {
    const suggestions = suggestSlugs('Demo South Cafe', ['Udaipur']);
    expect(suggestions).toContain('demo-south-cafe-udaipur');
    expect(suggestions.every((s) => validateSlug(s).ok)).toBe(true);
    expect(new Set(suggestions).size).toBe(suggestions.length);
  });
});

describe('google review url', () => {
  it.each([
    'https://g.page/r/CxYzAbC123/review',
    'https://maps.app.goo.gl/aBcD1234',
    'https://search.google.com/local/writereview?placeid=ChIJabc123',
    'https://www.google.com/maps/place/Demo+Cafe/@24.5,73.7,17z',
  ])('accepts %s', (url) => {
    expect(validateGoogleReviewUrl(url)).toMatchObject({ ok: true });
  });

  /** ONB-02-01. Not upgraded silently — this field redirects real customers. */
  it('rejects http', () => {
    expect(validateGoogleReviewUrl('http://g.page/r/abc/review')).toMatchObject({
      ok: false,
      reason: 'NOT_HTTPS',
    });
  });

  it('rejects non-Google hosts', () => {
    expect(validateGoogleReviewUrl('https://facebook.com/demo')).toMatchObject({
      reason: 'UNSUPPORTED_HOST',
    });
  });

  it('rejects a bare Google homepage with no business reference', () => {
    expect(validateGoogleReviewUrl('https://www.google.com/')).toMatchObject({
      reason: 'MISSING_PLACE_REFERENCE',
    });
  });

  it('rejects nonsense', () => {
    expect(validateGoogleReviewUrl('not a url')).toMatchObject({ reason: 'NOT_A_URL' });
  });

  /** ONB-02-03: stored normalized so the value stays stable and comparable. */
  it('normalizes host case, tracking params and trailing slash', () => {
    const result = normalizeGoogleReviewUrl(
      'https://G.PAGE/r/AbC/review/?utm_source=qr&utm_campaign=x#frag',
    );
    expect(result).toBe('https://g.page/r/AbC/review');
  });

  it('preserves meaningful query parameters', () => {
    const result = normalizeGoogleReviewUrl(
      'https://search.google.com/local/writereview?placeid=ChIJabc&utm_medium=email',
    );
    expect(result).toContain('placeid=ChIJabc');
    expect(result).not.toContain('utm_medium');
  });
});

describe('phone', () => {
  it('assumes +91 for a bare Indian mobile', () => {
    expect(normalizePhone('9876543210')).toEqual({ ok: true, e164: '+919876543210' });
  });

  it('accepts common Indian formats', () => {
    expect(normalizePhone('+91 98765 43210')).toEqual({ ok: true, e164: '+919876543210' });
    expect(normalizePhone('091-9876543210')).toMatchObject({ ok: true, e164: '+919876543210' });
    expect(normalizePhone('00919876543210')).toMatchObject({ ok: true, e164: '+919876543210' });
  });

  it('rejects impossible Indian mobiles', () => {
    expect(normalizePhone('123456789')).toMatchObject({ ok: false, reason: 'TOO_SHORT' });
    expect(normalizePhone('12345678901')).toMatchObject({ ok: false });
    expect(normalizePhone('5876543210')).toMatchObject({ reason: 'INVALID_INDIAN_MOBILE' });
    expect(normalizePhone('')).toMatchObject({ reason: 'EMPTY' });
  });

  it('passes through other country codes without Indian shape rules', () => {
    expect(normalizePhone('+14155552671')).toEqual({ ok: true, e164: '+14155552671' });
  });

  /** REQ-01-02: this only opens WhatsApp. The platform sends nothing (D-017, ADR-004). */
  it('builds a wa.me deep link with the message prefilled', () => {
    const link = buildWhatsAppLink('+919876543210', 'Hi Asha, how was your visit?');
    expect(link).toBe('https://wa.me/919876543210?text=Hi%20Asha%2C%20how%20was%20your%20visit%3F');
  });
});

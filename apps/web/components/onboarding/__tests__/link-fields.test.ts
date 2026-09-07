import { describe, expect, it } from 'vitest';
import {
  canonicalValue,
  isHttpsUrl,
  normalizeMobile,
  sectionState,
  withHttps,
} from '../link-fields';
// Imported from source rather than through `@ai-review/core`: the barrel reaches @node-rs/argon2
// and ioredis, and this suite is meant to run on a laptop with nothing installed but the workspace.
// phone.ts imports nothing, so the relative path costs nothing and buys the pin below.
import { normalizePhone } from '../../../../../packages/core/src/business/phone';

/**
 * ONB-03 field logic.
 *
 * The point of the first block is the pin: `normalizeMobile` is a hand-copied mirror of
 * `normalizePhone` that runs *before* the request, so anything it rejects can never reach the
 * server — a divergence is a number the owner cannot save however many times they retry. The
 * '00' case below is exactly that bug, so it is asserted against the core function itself rather
 * than against a literal a future edit could quietly change on both sides.
 */

/** Every shape 12_QA_Acceptance_Criteria and the core suite exercise, plus the divergences. */
const PHONE_CASES: readonly string[] = [
  '9876543210',
  '98765 43210',
  '+91 98765 43210',
  '+919876543210',
  '091-9876543210',
  '00919876543210',
  // The '00' international prefix on a non-Indian number: the case the mirror used to reject.
  '00447911123456',
  '0044 7911 123456',
  '+14155552671',
  '+447911123456',
  // Rejections.
  '',
  '   ',
  '123456789',
  '12345678901',
  '5876543210',
  '+1234567',
  '+1234567890123456',
  'not a phone',
];

describe('normalizeMobile mirrors packages/core normalizePhone', () => {
  it.each(PHONE_CASES)('agrees on %j', (input) => {
    const authoritative = normalizePhone(input);
    expect(normalizeMobile(input)).toBe(authoritative.ok ? authoritative.e164 : null);
  });

  /**
   * Named separately from the table so a regression reads as the bug it is rather than as one row
   * of a loop: the server stores '+447911123456' (phone.ts re-enters itself with '+' for a leading
   * '00'), and a mirror that returns null blocks the owner with "Enter a valid 10-digit mobile
   * number." on a value the handler would have accepted.
   */
  it('treats a leading 00 as the international prefix, not a trunk zero', () => {
    expect(normalizeMobile('00447911123456')).toBe('+447911123456');
    expect(normalizeMobile('00919876543210')).toBe('+919876543210');
  });

  /** D-002: a bare 10-digit number is Indian, and only Indian numbers get the 6-9 shape check. */
  it('assumes +91 for a bare Indian mobile and shape-checks it', () => {
    expect(normalizeMobile('98765 43210')).toBe('+919876543210');
    expect(normalizeMobile('5876543210')).toBeNull();
    expect(normalizeMobile('+14155552671')).toBe('+14155552671');
  });
});

describe('withHttps', () => {
  it('adds the scheme an owner pasting a bare host left off', () => {
    expect(withHttps('instagram.com/mycafe')).toBe('https://instagram.com/mycafe');
    expect(withHttps('  facebook.com/mycafe  ')).toBe('https://facebook.com/mycafe');
    expect(withHttps('//instagram.com/mycafe')).toBe('https://instagram.com/mycafe');
  });

  /** Promoting http to https would change where the button points, which is not a formatting fix. */
  it('never rewrites a scheme that is already there', () => {
    expect(withHttps('http://mycafe.example')).toBe('http://mycafe.example');
    expect(withHttps('https://mycafe.example')).toBe('https://mycafe.example');
    expect(withHttps('javascript:alert(1)')).toBe('javascript:alert(1)');
  });

  /** Without a dot it is not a host, and guessing would produce a link to nowhere. */
  it('leaves a value that is not a host alone, and empties a blank one', () => {
    expect(withHttps('mycafe')).toBe('mycafe');
    expect(withHttps('   ')).toBe('');
    expect(withHttps('///')).toBe('');
  });
});

describe('isHttpsUrl', () => {
  it('accepts only https, matching what the handler stores', () => {
    expect(isHttpsUrl('https://mycafe.example')).toBe(true);
    expect(isHttpsUrl('http://mycafe.example')).toBe(false);
    expect(isHttpsUrl('javascript:alert(1)')).toBe(false);
    expect(isHttpsUrl('mycafe.example')).toBe(false);
    expect(isHttpsUrl('')).toBe(false);
  });
});

describe('canonicalValue', () => {
  it('canonicalises a phone to the E.164 the server will store', () => {
    expect(canonicalValue('phone', ' 98765 43210 ')).toBe('+919876543210');
    expect(canonicalValue('phone', '00447911123456')).toBe('+447911123456');
  });

  /**
   * An un-normalisable number is returned unchanged so the error can name what the owner typed;
   * rewriting it would hide the mistake behind a value they never entered.
   */
  it('passes an un-normalisable number through untouched', () => {
    expect(canonicalValue('phone', '5876543210')).toBe('5876543210');
  });

  it('only trims a url, and empties whitespace for either kind', () => {
    expect(canonicalValue('url', '  https://mycafe.example  ')).toBe('https://mycafe.example');
    expect(canonicalValue('url', '   ')).toBe('');
    expect(canonicalValue('phone', '')).toBe('');
  });
});

describe('sectionState (ONB-03-02)', () => {
  it('is empty when nothing is entered and nothing is stored', () => {
    expect(sectionState({ current: '', stored: '', invalid: false })).toBe('empty');
  });

  it('is saved only when the entered value equals the stored one', () => {
    const stored = '+919876543210';
    expect(sectionState({ current: stored, stored, invalid: false })).toBe('saved');
    expect(sectionState({ current: '+919999999999', stored, invalid: false })).toBe('pending');
  });

  /** Clearing a field is a removal, and the owner has to see that before they continue. */
  it('is removing when a stored value has been cleared', () => {
    expect(sectionState({ current: '', stored: '+919876543210', invalid: false })).toBe('removing');
  });

  /** A message on the field outranks every other state: "Needs a fix" is the actionable one. */
  it('reports invalid ahead of anything else', () => {
    expect(sectionState({ current: '', stored: '', invalid: true })).toBe('invalid');
    expect(sectionState({ current: 'x', stored: 'x', invalid: true })).toBe('invalid');
    expect(sectionState({ current: '', stored: 'x', invalid: true })).toBe('invalid');
  });

  /**
   * Canonicalising both sides is what makes this true, and it is the reason the component passes
   * `canonicalValue` output in: without it a re-typed number reads as an unsaved change forever.
   */
  it('recognises a re-typed number as already saved once canonicalised', () => {
    const stored = canonicalValue('phone', '+919876543210');
    const current = canonicalValue('phone', '98765 43210');
    expect(sectionState({ current, stored, invalid: false })).toBe('saved');
  });
});

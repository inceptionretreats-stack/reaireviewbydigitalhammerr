import { describe, expect, it } from 'vitest';
// Type-only, so nothing from @ai-review/core (pg, ioredis, argon2) is loaded at runtime. It is here
// to make the rejection-copy table below exhaustive: adding a code to core fails this file's
// typecheck until ONB-01 has a sentence for it.
import type { SlugRejection } from '@ai-review/core';
import {
  DESCRIPTION_MAX,
  FIELD_KEYS,
  NAME_MAX,
  PLACE_MAX,
  UNKNOWN_REJECTION_COPY,
  contractMessage,
  describeUnavailable,
  isFieldKey,
  readAvailability,
  readFailure,
  readSaved,
  requiredErrors,
  saveOutcome,
} from '../business-identity';

/**
 * ONB-01's pure logic.
 *
 * SLUG_MIN_LENGTH / SLUG_MAX_LENGTH reach the screen as props, so the numbers here are arbitrary
 * stand-ins on purpose — they prove the copy uses what it was given rather than a constant of its
 * own.
 */
const SLUG_MIN = 3;
const SLUG_MAX = 48;

interface Identity {
  name: string;
  category: string;
  city: string;
  state: string;
  slug: string;
}

function identity(over: Partial<Identity> = {}): Identity {
  return {
    name: 'Cafe Mocha',
    category: 'Cafe or coffee shop',
    city: 'Pune',
    state: 'Maharashtra',
    slug: 'cafe-mocha',
    ...over,
  };
}

describe('requiredErrors', () => {
  it('accepts a complete identity', () => {
    expect(requiredErrors(identity())).toEqual({});
  });

  it.each([
    { field: 'name', body: identity({ name: '' }), message: 'Enter your business name.' },
    {
      field: 'category',
      body: identity({ category: '' }),
      message: 'Choose the category that fits best.',
    },
    { field: 'city', body: identity({ city: '' }), message: 'Enter the city you operate in.' },
    { field: 'state', body: identity({ state: '' }), message: 'Enter your state.' },
    { field: 'slug', body: identity({ slug: '' }), message: 'Choose an address for your page.' },
  ])('reports an empty $field, which the contract does not', ({ field, body, message }) => {
    expect(requiredErrors(body)).toEqual({ [field]: message });
  });

  it('reports every missing field at once, not just the first', () => {
    // The owner should not have to press Continue five times to discover five empty boxes.
    const errors = requiredErrors({ name: '', category: '', city: '', state: '', slug: '' });
    expect(Object.keys(errors)).toHaveLength(5);
  });

  it('does not treat a whitespace-only value as missing', () => {
    // BusinessStep trims before calling this, so ' ' arriving here would mean the trim was lost —
    // pinned so that a caller change shows up as a failing expectation rather than as a saved blank.
    expect(requiredErrors(identity({ city: ' ' }))).toEqual({});
  });
});

describe('describeUnavailable', () => {
  /**
   * Every code /business/slug-available can answer with: core's SlugRejection, plus the 'TAKEN' the
   * route adds for an address that is legal but owned. Exhaustive by type, so a new rejection code
   * cannot reach an owner as the generic fallback.
   */
  const copy: Record<SlugRejection | 'TAKEN', string> = {
    TAKEN: 'That address is already taken. Please choose another.',
    TOO_SHORT: `Use at least ${SLUG_MIN} characters.`,
    TOO_LONG: `Use at most ${SLUG_MAX} characters.`,
    RESERVED: 'That address is reserved. Please choose another.',
    NUMERIC_ONLY: 'Include at least one letter.',
    INVALID_CHARACTERS: 'Use only lowercase letters, numbers and hyphens.',
    CONSECUTIVE_HYPHENS: 'Avoid two hyphens in a row.',
    LEADING_OR_TRAILING_HYPHEN: 'Do not start or end with a hyphen.',
  };

  it.each(Object.entries(copy))('has copy of its own for %s', (reason, expected) => {
    const message = describeUnavailable(reason, SLUG_MIN, SLUG_MAX);
    expect(message).toBe(expected);
    expect(message).not.toBe(UNKNOWN_REJECTION_COPY);
  });

  it('uses the limits it is given rather than hardcoding them', () => {
    expect(describeUnavailable('TOO_SHORT', 5, 20)).toBe('Use at least 5 characters.');
    expect(describeUnavailable('TOO_LONG', 5, 20)).toBe('Use at most 20 characters.');
  });

  it('degrades to a sentence for a code this build does not know', () => {
    // The reason arrives from JSON, so an unknown one must read as English, not crash or show a code.
    expect(describeUnavailable('SOMETHING_NEW', SLUG_MIN, SLUG_MAX)).toBe(UNKNOWN_REJECTION_COPY);
    expect(describeUnavailable(null, SLUG_MIN, SLUG_MAX)).toBe(UNKNOWN_REJECTION_COPY);
  });
});

describe('contractMessage', () => {
  it('quotes the limit the input enforces, for every field the contract can reject', () => {
    expect(contractMessage('name', SLUG_MIN, SLUG_MAX)).toContain(String(NAME_MAX));
    expect(contractMessage('description', SLUG_MIN, SLUG_MAX)).toContain(String(DESCRIPTION_MAX));
    expect(contractMessage('city', SLUG_MIN, SLUG_MAX)).toContain(String(PLACE_MAX));
    expect(contractMessage('state', SLUG_MIN, SLUG_MAX)).toContain(String(PLACE_MAX));
    expect(contractMessage('slug', SLUG_MIN, SLUG_MAX)).toBe(
      `Use between ${SLUG_MIN} and ${SLUG_MAX} characters.`,
    );
  });

  it('is a finished sentence for every field, never a code', () => {
    // Driven off FIELD_KEYS, so a new form field cannot be added without copy for its rejection.
    for (const field of FIELD_KEYS) {
      const message = contractMessage(field, SLUG_MIN, SLUG_MAX);
      expect(message).not.toBe('');
      expect(message).toMatch(/[.!]$/);
    }
  });
});

describe('isFieldKey', () => {
  it('accepts the seven form fields and rejects anything else', () => {
    expect(isFieldKey('slug')).toBe(true);
    expect(isFieldKey('timezone')).toBe(true);
    // 'body' is what PATCH names for an issue with no field, and must never be highlighted as one.
    expect(isFieldKey('body')).toBe(false);
    expect(isFieldKey('__proto__')).toBe(false);
    expect(isFieldKey('')).toBe(false);
  });
});

describe('readAvailability', () => {
  it('narrows a well-formed answer', () => {
    expect(
      readAvailability({
        slug: 'cafe-mocha',
        available: false,
        reason: 'TAKEN',
        suggestions: ['cafe-mocha-pune', 'cafe-mocha-2'],
      }),
    ).toEqual({
      slug: 'cafe-mocha',
      available: false,
      reason: 'TAKEN',
      suggestions: ['cafe-mocha-pune', 'cafe-mocha-2'],
    });
  });

  it('rejects a payload missing either load-bearing member', () => {
    // null means "no verdict", which the screen shows as idle — never as available.
    expect(readAvailability({ available: true })).toBeNull();
    expect(readAvailability({ slug: 'cafe-mocha' })).toBeNull();
    expect(readAvailability({ slug: 'cafe-mocha', available: 'yes' })).toBeNull();
    expect(readAvailability(null)).toBeNull();
    expect(readAvailability('boom')).toBeNull();
    expect(readAvailability([])).toBeNull();
  });

  it('drops non-string suggestions instead of offering them as buttons', () => {
    const availability = readAvailability({
      slug: 'cafe',
      available: false,
      reason: null,
      suggestions: ['cafe-pune', 7, null, { slug: 'x' }],
    });
    expect(availability?.suggestions).toEqual(['cafe-pune']);
    expect(availability?.reason).toBeNull();
  });

  it('treats a non-string reason as no reason', () => {
    expect(readAvailability({ slug: 'cafe', available: false, reason: 409 })?.reason).toBeNull();
  });
});

describe('readSaved', () => {
  it('reads the claimed slug and the address it replaced', () => {
    expect(readSaved({ slug: 'cafe-mocha', previous_slug: 'cafe-moka' }, 'sent')).toEqual({
      slug: 'cafe-mocha',
      previousSlug: 'cafe-moka',
    });
  });

  it('reports no previous address when the claim created one (Flow I: nothing to redirect)', () => {
    expect(readSaved({ slug: 'cafe-mocha', previous_slug: null }, 'sent').previousSlug).toBeNull();
    expect(readSaved({ slug: 'cafe-mocha' }, 'sent').previousSlug).toBeNull();
  });

  it('falls back to the slug that was sent when the body says nothing usable', () => {
    // A 200 with an unreadable body still means the claim succeeded, so the panel must name the
    // address the owner actually typed rather than blank.
    expect(readSaved(null, 'cafe-mocha')).toEqual({ slug: 'cafe-mocha', previousSlug: null });
    expect(readSaved({ slug: 42 }, 'cafe-mocha').slug).toBe('cafe-mocha');
  });
});

describe('readFailure', () => {
  it('unpacks the error envelope from 23_API_Error_Codes.md', () => {
    expect(
      readFailure({
        error: {
          code: 'SLUG_UNAVAILABLE',
          message: 'That web address is already taken. Please choose another.',
          details: { fields: ['slug'] },
        },
      }),
    ).toEqual({
      code: 'SLUG_UNAVAILABLE',
      message: 'That web address is already taken. Please choose another.',
      fields: ['slug'],
    });
  });

  it('survives a non-object error member rather than throwing', () => {
    // A proxy error page, an HTML body, `{"error": null}`: reading `.code` off any of those would
    // throw into the save's catch and report "could not reach the server", which is not what
    // happened.
    for (const payload of [{ error: null }, { error: 'boom' }, { error: 7 }, { error: [] }]) {
      expect(() => readFailure(payload)).not.toThrow();
    }
    expect(readFailure({ error: null }).code).toBe('INTERNAL_ERROR');
    expect(readFailure({ error: 'boom' }).message).toBe('Something went wrong. Please try again.');
  });

  it('falls back for a payload that is not an envelope at all', () => {
    for (const payload of [null, undefined, 'gateway timeout', [], {}]) {
      expect(readFailure(payload)).toEqual({
        code: 'INTERNAL_ERROR',
        message: 'Something went wrong. Please try again.',
        fields: [],
      });
    }
  });

  it('ignores non-string field names and a details member that is not an object', () => {
    expect(readFailure({ error: { details: { fields: ['slug', 3, null] } } }).fields).toEqual([
      'slug',
    ]);
    expect(readFailure({ error: { details: 'slug' } }).fields).toEqual([]);
    expect(readFailure({ error: { details: { fields: 'slug' } } }).fields).toEqual([]);
  });
});

describe('saveOutcome', () => {
  it('holds the step when the save replaced the page address (Flow I disclosure)', () => {
    // The regression this guards: WizardShell navigates on any truthy return, so answering "leave"
    // here unmounts the only copy that tells the owner the old address still redirects.
    expect(saveOutcome({ slug: 'cafe-mocha', previousSlug: 'cafe-moka' })).toBe('hold-for-notice');
  });

  it('leaves when there is nothing to disclose', () => {
    expect(saveOutcome({ slug: 'cafe-mocha', previousSlug: null })).toBe('leave');
  });

  it('blocks when nothing was persisted', () => {
    expect(saveOutcome(null)).toBe('blocked');
  });
});

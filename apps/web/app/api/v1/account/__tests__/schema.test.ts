import { describe, expect, it } from 'vitest';
import {
  emailChanged,
  NAME_MAX,
  parseAccountDetails,
  parsePasswordChange,
  PASSWORD_MIN,
} from '../schema';

/**
 * The wire contract for SET-01's account endpoints.
 *
 * Worth testing rather than eyeballing, because three of these rules are security rules wearing
 * validation clothes: a password must not be trimmed (the stored credential would not match at the
 * next login), an absent current password must be distinguishable from an empty one (SET-01-01
 * decides whether to demand re-auth on that value), and "did the email change" must agree with a
 * citext column or the endpoint asks for a password when nothing changed.
 */

const VALID = {
  full_name: 'Asha Sharma',
  email: 'asha@example.com',
  mobile: '9876543210',
};

describe('parseAccountDetails', () => {
  it('accepts the fields SET-01 lists', () => {
    const result = parseAccountDetails(VALID);
    expect(result).toEqual({
      ok: true,
      value: {
        fullName: 'Asha Sharma',
        email: 'asha@example.com',
        mobile: '9876543210',
        currentPassword: null,
      },
    });
  });

  it('trims surrounding whitespace from the identity fields', () => {
    const result = parseAccountDetails({
      full_name: '  Asha Sharma  ',
      email: ' asha@example.com ',
      mobile: ' 9876543210 ',
    });

    expect(result.ok && result.value.fullName).toBe('Asha Sharma');
    expect(result.ok && result.value.email).toBe('asha@example.com');
    expect(result.ok && result.value.mobile).toBe('9876543210');
  });

  /**
   * A password is an opaque secret. Trimming one changes it, so a password with an edge space
   * would be accepted here as re-authentication and then fail at the next login.
   */
  it('does not trim the current password', () => {
    const result = parseAccountDetails({ ...VALID, current_password: '  spaced secret  ' });
    expect(result.ok && result.value.currentPassword).toBe('  spaced secret  ');
  });

  it('reports an absent or empty current password as null, not as an empty string', () => {
    const absent = parseAccountDetails(VALID);
    expect(absent.ok && absent.value.currentPassword).toBeNull();

    const empty = parseAccountDetails({ ...VALID, current_password: '' });
    expect(empty.ok && empty.value.currentPassword).toBeNull();

    const wrongType = parseAccountDetails({ ...VALID, current_password: 12345 });
    expect(wrongType.ok && wrongType.value.currentPassword).toBeNull();
  });

  it.each([
    ['a name of one character', { ...VALID, full_name: 'A' }, 'full_name'],
    ['a name past the column cap', { ...VALID, full_name: 'x'.repeat(NAME_MAX + 1) }, 'full_name'],
    ['an address with no domain dot', { ...VALID, email: 'asha@example' }, 'email'],
    ['an address with a space', { ...VALID, email: 'as ha@example.com' }, 'email'],
    ['an address with two at signs', { ...VALID, email: 'a@b@example.com' }, 'email'],
    ['a missing address', { full_name: VALID.full_name, mobile: VALID.mobile }, 'email'],
    ['a mobile that is too short', { ...VALID, mobile: '98765' }, 'mobile'],
    ['a mobile that is too long', { ...VALID, mobile: '9'.repeat(21) }, 'mobile'],
  ])('rejects %s and names the field', (_case, body, field) => {
    const result = parseAccountDetails(body);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.fields).toEqual([field]);
  });

  it.each([null, undefined, 'a string', 42])('rejects %s as a body', (body) => {
    expect(parseAccountDetails(body).ok).toBe(false);
  });
});

describe('parsePasswordChange', () => {
  it('accepts a current password and a new one at the minimum length', () => {
    const result = parsePasswordChange({
      current_password: 'old password here',
      new_password: 'x'.repeat(PASSWORD_MIN),
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.value.newPassword).toHaveLength(PASSWORD_MIN);
  });

  it('preserves both passwords exactly, including edge whitespace', () => {
    const result = parsePasswordChange({
      current_password: ' old secret ',
      new_password: ' brand new secret ',
    });

    expect(result.ok && result.value.currentPassword).toBe(' old secret ');
    expect(result.ok && result.value.newPassword).toBe(' brand new secret ');
  });

  it('requires the current password, which is what SET-01-01 turns on', () => {
    const result = parsePasswordChange({ new_password: 'x'.repeat(PASSWORD_MIN) });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.fields).toEqual(['current_password']);
  });

  it('rejects a new password below the minimum length', () => {
    const result = parsePasswordChange({
      current_password: 'old password here',
      new_password: 'x'.repeat(PASSWORD_MIN - 1),
    });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.fields).toEqual(['new_password']);
  });

  /**
   * The bound exists so that nothing absurd reaches Argon2id, which is deliberately slow. The
   * strength rules themselves stay with validatePasswordStrength in @ai-review/core.
   */
  it('rejects a new password past the maximum length', () => {
    const result = parsePasswordChange({
      current_password: 'old password here',
      new_password: 'x'.repeat(257),
    });
    expect(result.ok).toBe(false);
  });

  it('does not enforce a length on the current password', () => {
    // A too-short *current* password must be a wrong-password answer from the hash comparison,
    // not a validation error that describes the stored credential.
    const result = parsePasswordChange({ current_password: 'a', new_password: 'x'.repeat(20) });
    expect(result.ok).toBe(true);
  });
});

describe('emailChanged', () => {
  it('treats a change of case as unchanged, because users.email is citext', () => {
    expect(emailChanged('Asha@Example.com', 'asha@example.com')).toBe(false);
  });

  it('treats surrounding whitespace as unchanged', () => {
    expect(emailChanged(' asha@example.com ', 'asha@example.com')).toBe(false);
  });

  it('sees a real change', () => {
    expect(emailChanged('asha@example.com', 'asha@example.in')).toBe(true);
    expect(emailChanged('asha+billing@example.com', 'asha@example.com')).toBe(true);
  });
});

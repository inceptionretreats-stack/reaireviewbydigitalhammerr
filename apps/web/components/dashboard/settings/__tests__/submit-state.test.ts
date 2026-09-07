import { describe, expect, it } from 'vitest';
import type { SubmitState } from '../../../auth/use-form-submit';
import { readBoolean, readCount, unattachedFailure } from '../use-settings-submit';

/**
 * The rule that decides whether a server refusal is visible at all (AC-037).
 *
 * The bug these tests exist to catch: the banner used to render only when `details.fields` was
 * EMPTY, so a rejection naming a field the form was not showing disappeared entirely. Two real
 * responses do that. `PATCH /api/v1/account` answers `['current_password']` whenever the submitted
 * address differs from the STORED one — which the client cannot predict, because it compares
 * against the address this browser last saw saved, so the two disagree the moment the address is
 * changed in another tab. And `parseAccountDetails` answers `['body']`, which is not an input on
 * any screen. In both cases the owner pressed Save, the request was refused, and nothing appeared.
 */

const failure = (fields: string[], message = 'Enter your current password.'): SubmitState => ({
  status: 'error',
  failure: { code: 'VALIDATION_FAILED', message, fields },
});

const ACCOUNT_FIELDS_WITHOUT_PASSWORD = ['full_name', 'email', 'mobile'] as const;
const ACCOUNT_FIELDS_WITH_PASSWORD = [...ACCOUNT_FIELDS_WITHOUT_PASSWORD, 'current_password'];

describe('unattachedFailure', () => {
  it('surfaces a refusal naming a field the form is not showing', () => {
    expect(unattachedFailure(failure(['current_password']), ACCOUNT_FIELDS_WITHOUT_PASSWORD)).toBe(
      'Enter your current password.',
    );
  });

  it('stays silent once that same field is on screen, because the field carries it', () => {
    expect(
      unattachedFailure(failure(['current_password']), ACCOUNT_FIELDS_WITH_PASSWORD),
    ).toBeNull();
  });

  it('surfaces a malformed-body refusal, which names no input anywhere', () => {
    const state = failure(['body'], 'Malformed request body.');
    expect(unattachedFailure(state, ACCOUNT_FIELDS_WITH_PASSWORD)).toBe('Malformed request body.');
  });

  it('surfaces a failure that named no field at all', () => {
    const state = failure([], 'Your password was just changed elsewhere. Please retry.');
    expect(unattachedFailure(state, ACCOUNT_FIELDS_WITH_PASSWORD)).toBe(
      'Your password was just changed elsewhere. Please retry.',
    );
  });

  it('stays silent when at least one named field is rendered', () => {
    // A multi-field rejection is answerable as long as something on screen shows the message.
    expect(unattachedFailure(failure(['email', 'body']), ACCOUNT_FIELDS_WITH_PASSWORD)).toBeNull();
  });

  it('has nothing to say about idle, submitting or successful states', () => {
    expect(unattachedFailure({ status: 'idle' }, ACCOUNT_FIELDS_WITH_PASSWORD)).toBeNull();
    expect(unattachedFailure({ status: 'submitting' }, ACCOUNT_FIELDS_WITH_PASSWORD)).toBeNull();
    expect(
      unattachedFailure({ status: 'success', payload: {} }, ACCOUNT_FIELDS_WITH_PASSWORD),
    ).toBeNull();
  });
});

/**
 * `sessions_swept` is the flag that stops the password confirmation claiming a sweep that did not
 * happen, so the default when the server omitted it has to be the cautious one.
 */
describe('readBoolean', () => {
  it('reads a flag the endpoint sent', () => {
    const state: SubmitState = { status: 'success', payload: { sessions_swept: true } };
    expect(readBoolean(state, 'sessions_swept')).toBe(true);
  });

  it('is false when the field is absent, not undefined', () => {
    expect(readBoolean({ status: 'success', payload: {} }, 'sessions_swept')).toBe(false);
  });

  it('does not treat a truthy non-boolean as true', () => {
    const state: SubmitState = { status: 'success', payload: { sessions_swept: 'yes' } };
    expect(readBoolean(state, 'sessions_swept')).toBe(false);
  });

  it('is false for a failed request', () => {
    expect(readBoolean(failure([]), 'sessions_swept')).toBe(false);
  });
});

describe('readCount', () => {
  it('reads a count the endpoint sent', () => {
    const state: SubmitState = { status: 'success', payload: { other_sessions_signed_out: 3 } };
    expect(readCount(state, 'other_sessions_signed_out')).toBe(3);
  });

  it('never reports a negative or fractional count as a number of sessions', () => {
    const negative: SubmitState = { status: 'success', payload: { n: -4 } };
    const fractional: SubmitState = { status: 'success', payload: { n: 2.7 } };
    expect(readCount(negative, 'n')).toBe(0);
    expect(readCount(fractional, 'n')).toBe(2);
  });

  it('is zero for a missing, non-numeric or non-finite value', () => {
    expect(readCount({ status: 'success', payload: {} }, 'n')).toBe(0);
    expect(readCount({ status: 'success', payload: { n: '3' } }, 'n')).toBe(0);
    expect(readCount({ status: 'success', payload: { n: Number.NaN } }, 'n')).toBe(0);
  });
});

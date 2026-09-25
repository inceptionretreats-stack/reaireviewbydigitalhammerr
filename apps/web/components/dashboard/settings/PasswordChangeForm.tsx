'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { Button, Card, Field, InlineError, Input } from '@ai-review/ui';
import { PASSWORD_MAX, PASSWORD_MIN } from '@/lib/account/schema';
import { fieldError } from '@/components/shared/forms/use-form-submit';
import { describePasswordChangeSessions } from './copy';
import {
  readBoolean,
  readCount,
  unattachedFailure,
  useSettingsSubmit,
} from './use-settings-submit';

/**
 * SET-01's "Change password".
 *
 * Three inputs, and the first of them is the point: SET-01-01 requires the CURRENT password, so a
 * stolen session cannot lock the real owner out of their own account. The field is here because the
 * endpoint demands it, not as a formality — see POST /api/v1/account/password.
 *
 * The confirmation field is client-side only and is not sent. Its whole purpose is to catch a typo
 * in something the owner cannot see, and the server has no use for a second copy of a secret.
 *
 * What happens after a successful change is stated rather than left to be discovered: every other
 * session is signed out (SET-01-02) and this browser is kept, which is what the rotation in
 * 13_Security_Privacy_Compliance.md does when the caller's own session is the one being replaced.
 * An owner who is not told would reasonably assume their phone is still signed in.
 */

type FieldKey = 'current_password' | 'new_password' | 'confirm_password';
type LocalErrors = Partial<Record<FieldKey, string>>;

export function PasswordChangeForm() {
  const router = useRouter();
  const { state, submit, reset } = useSettingsSubmit('/api/v1/account/password', 'POST');

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [localErrors, setLocalErrors] = useState<LocalErrors>({});

  const busy = state.status === 'submitting';

  const touched = useCallback(
    (field: FieldKey) => {
      setLocalErrors(({ [field]: _cleared, ...rest }) => rest);
      if (state.status !== 'idle') reset();
    },
    [reset, state.status],
  );

  const errorFor = (field: FieldKey): string | undefined =>
    localErrors[field] ?? fieldError(state, field) ?? undefined;

  const change = useCallback(async () => {
    const errors: LocalErrors = {};

    if (currentPassword === '') errors.current_password = 'Enter your current password.';
    // Mirrors PASSWORD_MIN_LENGTH in @ai-review/core so the message arrives without a round trip.
    // validatePasswordStrength on the server stays authoritative, including the rules this cannot
    // check here — a password is never sent anywhere to be judged before it is set.
    if (newPassword.length < PASSWORD_MIN) {
      errors.new_password = `Use at least ${PASSWORD_MIN} characters.`;
    }
    if (confirmPassword !== newPassword) {
      errors.confirm_password = 'These two do not match.';
    }

    if (Object.keys(errors).length > 0) {
      setLocalErrors(errors);
      return;
    }
    setLocalErrors({});

    const result = await submit({
      current_password: currentPassword,
      new_password: newPassword,
    });

    if (result.status !== 'success') return;

    // Cleared the moment the request is answered. Leaving a password in a form field means it stays
    // in the DOM, in the browser's autofill heuristics and in any screenshot of the page.
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    // The endpoint rotated this browser's session cookie and swept the others, so the server-side
    // session count elsewhere on this screen is now wrong until the page is re-rendered.
    router.refresh();
  }, [confirmPassword, currentPassword, newPassword, router, submit]);

  const changed = state.status === 'success';
  const signedOut = readCount(state, 'other_sessions_signed_out');
  /*
   * The password is committed before the sweep and the rotation, so the endpoint answers 200 with
   * `sessions_swept: false` when that post-commit work failed. Read here rather than assumed: the
   * confirmation below would otherwise claim a sweep that did not happen.
   */
  const swept = readBoolean(state, 'sessions_swept');

  /* Every field this form has is always on screen, so only `body` and an unattached failure land
     in the banner — but the test is still intersection, not emptiness. See `unattachedFailure`. */
  const unattached = unattachedFailure(state, [
    'current_password',
    'new_password',
    'confirm_password',
  ]);

  return (
    <Card
      title="Password"
      titleAs="h2"
      description="Changing your password signs out every other session and keeps this one."
    >
      <div className="flex flex-col gap-5">
        {/* A failure naming no field on screen would otherwise be an invisible refusal. */}
        {unattached !== null && <InlineError>{unattached}</InlineError>}

        {/*
          Mounted from the first render and `sr-only` while empty: a live region inserted into the
          DOM together with its text is not reliably announced, and this confirmation is the only
          thing that tells the owner the change went through (AC-037, AC-038).
        */}
        <div
          role="status"
          aria-live="polite"
          className={
            changed
              ? 'rounded-card border border-success bg-success-soft px-4 py-3 text-sm text-success'
              : 'sr-only'
          }
        >
          {changed && (
            <>
              <p className="font-semibold">
                <span aria-hidden="true">{'✓'}</span> Your password has been changed
              </p>
              <p className="mt-1">{describePasswordChangeSessions(swept, signedOut)}</p>
            </>
          )}
        </div>

        <Field label="Current password" required error={errorFor('current_password')}>
          {(control) => (
            <Input
              {...control}
              type="password"
              name="current_password"
              value={currentPassword}
              onChange={(event) => {
                setCurrentPassword(event.target.value);
                touched('current_password');
              }}
              autoComplete="current-password"
              disabled={busy}
            />
          )}
        </Field>

        <Field
          label="New password"
          required
          error={errorFor('new_password')}
          hint={`At least ${PASSWORD_MIN} characters. A phrase you can remember beats a short word.`}
        >
          {(control) => (
            <Input
              {...control}
              type="password"
              name="new_password"
              value={newPassword}
              onChange={(event) => {
                setNewPassword(event.target.value);
                touched('new_password');
                // The confirmation is judged against this value, so its verdict is stale now.
                touched('confirm_password');
              }}
              autoComplete="new-password"
              maxLength={PASSWORD_MAX}
              disabled={busy}
            />
          )}
        </Field>

        <Field label="Repeat the new password" required error={errorFor('confirm_password')}>
          {(control) => (
            <Input
              {...control}
              type="password"
              name="confirm_password"
              value={confirmPassword}
              onChange={(event) => {
                setConfirmPassword(event.target.value);
                touched('confirm_password');
              }}
              autoComplete="new-password"
              maxLength={PASSWORD_MAX}
              disabled={busy}
            />
          )}
        </Field>

        <div>
          <Button
            loading={busy}
            loadingLabel="Changing your password"
            onClick={() => void change()}
          >
            Change password
          </Button>
        </div>
      </div>
    </Card>
  );
}

'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { Button, Card, Field, InlineError, Input } from '@ai-review/ui';
import {
  EMAIL_MAX,
  MOBILE_MAX,
  NAME_MAX,
  NAME_MIN,
  emailChanged,
} from '@/app/api/v1/account/schema';
import { fieldError } from '../../auth/use-form-submit';
import { readBoolean, unattachedFailure, useSettingsSubmit } from './use-settings-submit';

/**
 * SET-01's account fields: name, email, mobile, and Save.
 *
 * The three UI states the screen spec requires are all here — `default`, `saved` and `error` — with
 * `submitting` handled by the button rather than by a fourth state, so the form stays on screen and
 * keyboard focus never leaves the control the owner pressed (AC-037; see Button's `loading`).
 *
 * The current-password field is the visible half of SET-01-01. It appears only when the address in
 * the field differs from the saved one, using the same comparison the endpoint makes — a citext
 * column means a change of case is not a change (`emailChanged`), so retyping your own address in
 * capitals does not demand a password. Asking only when it is needed matters: a screen that asks
 * for a password on every save teaches an owner to type it whenever something asks.
 *
 * The maxima come from the wire contract in `app/api/v1/account/schema.ts` rather than being
 * restated, so a field cannot let someone type past what the endpoint will accept.
 */

export interface AccountDetailsFormProps {
  initial: { fullName: string; email: string; mobile: string; hasPassword: boolean };
}

type FieldKey = 'full_name' | 'email' | 'mobile' | 'current_password';
type LocalErrors = Partial<Record<FieldKey, string>>;

export function AccountDetailsForm({ initial }: AccountDetailsFormProps) {
  const router = useRouter();
  const { state, submit, reset } = useSettingsSubmit('/api/v1/account', 'PATCH');

  const [fullName, setFullName] = useState(initial.fullName);
  const [email, setEmail] = useState(initial.email);
  const [mobile, setMobile] = useState(initial.mobile);
  const [currentPassword, setCurrentPassword] = useState('');
  const [localErrors, setLocalErrors] = useState<LocalErrors>({});

  /**
   * The address as last saved, which is what "changed" is measured against.
   *
   * Held in state rather than read from `initial` because after a successful save the prop is one
   * render behind: without this the form would keep demanding the password for an address it has
   * already stored.
   */
  const [savedEmail, setSavedEmail] = useState(initial.email);

  /**
   * Set when the endpoint asks for the current password on a save this form thought needed none.
   *
   * The two sides measure "changed" against different addresses: the handler compares against the
   * STORED one, this form against the address it last saw saved. They disagree whenever the address
   * moved in another tab or on another device, and the handler then answers 422 naming
   * `current_password` — a field that is not on screen. Showing it is what makes the refusal
   * answerable rather than merely visible.
   *
   * Held in state rather than derived from `state.failure`, because `touched` clears the submit
   * state on the first keystroke: a derived field would unmount under the person typing into it.
   */
  const [passwordDemanded, setPasswordDemanded] = useState(false);

  const needsPassword =
    initial.hasPassword && (emailChanged(email, savedEmail) || passwordDemanded);
  const busy = state.status === 'submitting';

  /** Clears a stale message so a correction is never made underneath one. */
  const touched = useCallback(
    (field: FieldKey) => {
      setLocalErrors(({ [field]: _cleared, ...rest }) => rest);
      if (state.status !== 'idle') reset();
    },
    [reset, state.status],
  );

  const errorFor = (field: FieldKey): string | undefined =>
    localErrors[field] ?? fieldError(state, field) ?? undefined;

  const save = useCallback(async () => {
    const trimmed = { fullName: fullName.trim(), email: email.trim(), mobile: mobile.trim() };
    const errors: LocalErrors = {};

    // Mirrors the contract rather than adding rules to it: these only save a round trip and put the
    // message beside the field. The endpoint remains the thing that decides.
    if (trimmed.fullName.length < NAME_MIN) errors.full_name = 'Enter your name.';
    if (trimmed.email === '') errors.email = 'Enter your email address.';
    if (trimmed.mobile === '') errors.mobile = 'Enter your mobile number.';
    if (needsPassword && currentPassword === '') {
      errors.current_password = 'Enter your current password to change your email.';
    }

    if (Object.keys(errors).length > 0) {
      setLocalErrors(errors);
      return;
    }
    setLocalErrors({});

    const result = await submit({
      full_name: trimmed.fullName,
      email: trimmed.email,
      mobile: trimmed.mobile,
      // Sent only when it is required, so a password is not put on the wire for a name edit.
      ...(needsPassword ? { current_password: currentPassword } : {}),
    });

    if (result.status !== 'success') {
      // The endpoint asked for a password this form had not shown. Keep the field on screen so the
      // owner can answer the refusal instead of re-pressing Save against the same rejection.
      if (fieldError(result, 'current_password') !== null) setPasswordDemanded(true);
      return;
    }

    setPasswordDemanded(false);
    setSavedEmail(trimmed.email);
    setFullName(trimmed.fullName);
    setEmail(trimmed.email);
    setMobile(trimmed.mobile);
    // Cleared immediately: there is no reason for a password to sit in a form field after the
    // request that needed it has been answered.
    setCurrentPassword('');
    // The server rendered this screen's values, and the header of the dashboard may read them too.
    // Without this the page keeps showing what was there before until a hard reload.
    router.refresh();
  }, [currentPassword, email, fullName, mobile, needsPassword, router, submit]);

  const saved = state.status === 'success';

  /*
   * Which keys are actually rendered, which is what decides whether a failure can be seen. The
   * password field is only one of them while it is on screen, and `body` — what
   * `parseAccountDetails` names when the request was not JSON — is never one at all.
   */
  const renderedFields: readonly FieldKey[] = needsPassword
    ? ['full_name', 'email', 'mobile', 'current_password']
    : ['full_name', 'email', 'mobile'];
  const unattached = unattachedFailure(state, renderedFields);

  /**
   * The endpoint answers true only when a verification timestamp was actually discarded, so this
   * needs no prop and cannot go stale after `router.refresh()` replaces the props below it.
   */
  const verificationCleared = readBoolean(state, 'email_verification_cleared');

  return (
    <Card
      title="Your account"
      titleAs="h2"
      description="The name, email and mobile number we hold for you."
    >
      <div className="flex flex-col gap-5">
        {/*
          A failure naming no field that is currently on screen would otherwise be an invisible
          refusal — see `unattachedFailure`. Emptiness is not the test: `['current_password']` on a
          form not showing that field, and `['body']`, are both messages with nowhere else to go.
        */}
        {unattached !== null && <InlineError>{unattached}</InlineError>}

        {/*
          Mounted from the first render and `sr-only` while empty, for the reason the hint region
          below gives: a live region inserted into the DOM together with its text is not reliably
          announced, so a confirmation that appears with the region is a confirmation a screen
          reader user may never hear (AC-037, AC-038).
        */}
        <div
          role="status"
          aria-live="polite"
          className={
            saved
              ? 'rounded-card border border-success bg-success-soft px-4 py-3 text-sm text-success'
              : 'sr-only'
          }
        >
          {saved && (
            <>
              <p className="font-semibold">
                <span aria-hidden="true">{'✓'}</span> Saved
              </p>
              {/*
                Changing the address clears users.email_verified_at, because the new address has
                been proved by nobody (see PATCH /api/v1/account). Said out loud rather than done
                quietly — and only to the accounts it actually affects, so nobody is told they lost
                something they never had.
              */}
              {verificationCleared && (
                <p className="mt-1">
                  This address has not been confirmed by us. There is nothing you need to do now —
                  email confirmation is not part of this version.
                </p>
              )}
            </>
          )}
        </div>

        <Field label="Your name" required error={errorFor('full_name')}>
          {(control) => (
            <Input
              {...control}
              name="full_name"
              value={fullName}
              onChange={(event) => {
                setFullName(event.target.value);
                touched('full_name');
              }}
              autoComplete="name"
              maxLength={NAME_MAX}
              disabled={busy}
            />
          )}
        </Field>

        <Field
          label="Email"
          required
          error={errorFor('email')}
          hint={
            initial.hasPassword
              ? 'You sign in with this address.'
              : 'This is the email on your connected Google account. It cannot be changed here.'
          }
        >
          {(control) => (
            <Input
              {...control}
              type="email"
              name="email"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                touched('email');
              }}
              autoComplete="email"
              inputMode="email"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={EMAIL_MAX}
              disabled={busy || !initial.hasPassword}
            />
          )}
        </Field>

        {/*
          Polite, and mounted from the first render even while empty — a live region has to exist
          before its content changes or nothing is announced. The password field below appears
          mid-typing, and an owner not watching that part of the screen would otherwise meet it as a
          validation error on Save rather than as an explanation.

          `sr-only` while empty rather than unmounted: an absolutely positioned element is not a
          flex item, so the empty region cannot leave a phantom gap between the two fields, and it
          stays in the accessibility tree either way.
        */}
        <div
          role="status"
          aria-live="polite"
          className={needsPassword ? 'text-sm text-ink-muted' : 'sr-only'}
        >
          {needsPassword && (
            <p>
              Changing your email needs your current password. That way someone who finds your
              screen unlocked cannot quietly move the account to their own address.
            </p>
          )}
        </div>

        {needsPassword && (
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
        )}

        <Field
          label="Mobile"
          required
          error={errorFor('mobile')}
          hint="A 10-digit Indian mobile number, or any number with its country code."
        >
          {(control) => (
            <Input
              {...control}
              type="tel"
              name="mobile"
              value={mobile}
              onChange={(event) => {
                setMobile(event.target.value);
                touched('mobile');
              }}
              autoComplete="tel"
              inputMode="tel"
              maxLength={MOBILE_MAX}
              disabled={busy}
            />
          )}
        </Field>

        <div>
          <Button loading={busy} loadingLabel="Saving your details" onClick={() => void save()}>
            Save
          </Button>
        </div>
      </div>
    </Card>
  );
}

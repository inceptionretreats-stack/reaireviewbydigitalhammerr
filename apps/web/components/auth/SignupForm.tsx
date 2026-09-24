'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, Checkbox, Field, InlineError, Input } from '@ai-review/ui';
import { GoogleSignIn } from './GoogleSignIn';
import { fieldError, useFormSubmit } from './use-form-submit';

/**
 * AUTH-01. Five required inputs and the terms checkbox, with the states the screen spec lists:
 * default, submitting, email exists, validation error, success.
 *
 * "email exists" is not a separate visual state here — it arrives as a validation error scoped
 * to the email field, which is what it is. The spec lists it separately because it is the one
 * failure a person can act on differently (sign in instead), so the message says so.
 *
 * Client validation mirrors the server contract but is never trusted by it: server-side
 * validation is authoritative per the screen spec's preamble. Its job is to save a round trip,
 * not to be the check.
 */
export function SignupForm({ googleClientId }: { googleClientId: string | null }) {
  const router = useRouter();
  const { state, submit, reset } = useFormSubmit('/api/v1/auth/signup');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [termsError, setTermsError] = useState<string | null>(null);

  const submitting = state.status === 'submitting';

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

    if (!acceptedTerms) {
      setTermsError('Please accept the terms to continue.');
      return;
    }
    setTermsError(null);

    const result = await submit({
      full_name: String(form.get('full_name') ?? ''),
      email: String(form.get('email') ?? ''),
      mobile: String(form.get('mobile') ?? ''),
      password: String(form.get('password') ?? ''),
      accept_terms: true,
    });

    if (result.status === 'success') {
      // Straight into onboarding rather than the dashboard: a shell tenant has nothing to show,
      // and ONB-01 is the next thing the owner has to do (Flow A step 4).
      router.push('/onboarding/business');
    }
  }

  const emailFailure = fieldError(state, 'email');

  return (
    <form method="post" onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-bold tracking-tight text-ink">Create your account</h1>
        <p className="text-sm text-ink-muted">
          Set up your business and get a QR code in a few minutes.
        </p>
      </div>

      {googleClientId && (
        <>
          <GoogleSignIn clientId={googleClientId} />
          <p className="text-center text-xs font-medium text-ink-muted">or sign up with email</p>
        </>
      )}

      {state.status === 'error' && state.failure.fields.length === 0 && (
        <InlineError>{state.failure.message}</InlineError>
      )}

      <Field label="Your name" required error={fieldError(state, 'full_name')}>
        {(control) => (
          <Input
            {...control}
            name="full_name"
            autoComplete="name"
            minLength={2}
            maxLength={80}
            disabled={submitting}
          />
        )}
      </Field>

      <Field
        label="Email"
        required
        error={emailFailure}
        hint={emailFailure ? undefined : 'Used to sign in and to recover your account.'}
      >
        {(control) => (
          <Input
            {...control}
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            disabled={submitting}
            onChange={reset}
          />
        )}
      </Field>

      <Field label="Mobile number" required error={fieldError(state, 'mobile')} hint="10 digits.">
        {(control) => (
          <Input
            {...control}
            name="mobile"
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            disabled={submitting}
          />
        )}
      </Field>

      <Field
        label="Password"
        required
        error={fieldError(state, 'password')}
        hint="At least 12 characters."
      >
        {(control) => (
          <Input
            {...control}
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={12}
            disabled={submitting}
          />
        )}
      </Field>

      <Checkbox
        name="accept_terms"
        checked={acceptedTerms}
        onChange={(event) => {
          setAcceptedTerms(event.target.checked);
          if (event.target.checked) setTermsError(null);
        }}
        error={termsError}
        disabled={submitting}
        label={
          <span>
            I accept the{' '}
            <a
              className="text-accent underline underline-offset-4"
              href="/legal/terms"
              target="_blank"
              rel="noopener noreferrer"
            >
              terms of service
            </a>{' '}
            and{' '}
            <a
              className="text-accent underline underline-offset-4"
              href="/legal/privacy"
              target="_blank"
              rel="noopener noreferrer"
            >
              privacy policy
            </a>
          </span>
        }
        description="Policy links open in a new tab so your form stays here."
      />

      <Button
        type="submit"
        size="lg"
        fullWidth
        loading={submitting}
        loadingLabel="Creating your account"
      >
        Create account
      </Button>

      <p className="auth-switch text-center text-sm text-ink-muted">
        Already have an account?{' '}
        <a href="/login" className="text-accent">
          Sign in
        </a>
      </p>
    </form>
  );
}

'use client';

import { Button, Field, InlineError, Input } from '@ai-review/ui';
import { useFormSubmit } from './use-form-submit';

/**
 * AUTH-03. States from the screen spec: default, sent, rate limited.
 *
 * Note that "rate limited" is unreachable as a distinct state, and that is correct. AUTH-03-01
 * requires neutral wording always, so the server answers 202 even when the limiter has tripped —
 * a 429 here would confirm the address is worth retrying. The state exists in the spec, and the
 * compliant implementation of it is the same screen as `sent`.
 *
 * The success copy is deliberately conditional in tone: it says "if that address has an
 * account", because promising an email to an address with no account is both a lie and a
 * disclosure.
 */
export function ForgotPasswordForm() {
  const { state, submit } = useFormSubmit('/api/v1/auth/forgot-password');
  const submitting = state.status === 'submitting';

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await submit({ email: String(form.get('email') ?? '') });
  }

  if (state.status === 'success') {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-bold tracking-tight text-ink">Check your email</h1>
        <p className="text-sm text-ink-muted">
          If that email address has an account, a reset link is on its way. The link works once and
          expires in an hour.
        </p>
        <p className="text-sm text-ink-muted">
          Nothing arrived? Check your spam folder, or{' '}
          <a href="/forgot-password" className="text-accent">
            try again
          </a>
          .
        </p>
        <a href="/login" className="text-sm text-accent">
          Back to sign in
        </a>
      </div>
    );
  }

  return (
    <form method="post" onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-bold tracking-tight text-ink">Reset your password</h1>
        <p className="text-sm text-ink-muted">
          Enter the email address you signed up with and we will send you a link.
        </p>
      </div>

      {state.status === 'error' && <InlineError>{state.failure.message}</InlineError>}

      <Field label="Email" required>
        {(control) => (
          <Input
            {...control}
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            disabled={submitting}
          />
        )}
      </Field>

      <Button
        type="submit"
        size="lg"
        fullWidth
        loading={submitting}
        loadingLabel="Sending the link"
      >
        Send reset link
      </Button>

      <a href="/login" className="text-center text-sm text-accent">
        Back to sign in
      </a>
    </form>
  );
}

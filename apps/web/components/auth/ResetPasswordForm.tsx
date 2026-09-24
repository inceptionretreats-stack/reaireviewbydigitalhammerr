'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, Field, InlineError, Input } from '@ai-review/ui';
import { fieldError, useFormSubmit } from '../shared/forms/use-form-submit';

/**
 * The reset screen, which 03_Screen_Field_Button_Spec.md never defines.
 *
 * AUTH-03 issues a single-use expiring token but the pack specifies no screen to spend it on,
 * and no endpoint either — both recorded as OPEN-03 in docs/SPEC_AMENDMENTS.md. The states below
 * are therefore designed rather than transcribed: no token, invalid or expired token, validation
 * error, and success.
 *
 * The token arrives in the query string, which is unavoidable for an emailed link. Two
 * consequences are handled: it is never rendered into the page (so it stays out of screenshots
 * and support tickets), and the server invalidates it on use so a link surviving in browser
 * history is inert.
 */
export function ResetPasswordForm({ token }: { token: string | undefined }) {
  const router = useRouter();
  const { state, submit } = useFormSubmit('/api/v1/auth/reset-password');
  // Declared above the early return below: hooks must run in the same order on every render,
  // so a useState after a conditional return would break on the first token-less visit.
  const [mismatch, setMismatch] = useState<string | null>(null);
  const submitting = state.status === 'submitting';

  if (!token) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-bold tracking-tight text-ink">This link is incomplete</h1>
        <p className="text-sm text-ink-muted">
          The reset link is missing its code. Some email clients break long links across lines — try
          copying the whole link, or request a new one.
        </p>
        <a href="/forgot-password" className="text-sm text-accent">
          Request a new link
        </a>
      </div>
    );
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get('password') ?? '');
    const confirm = String(form.get('confirm') ?? '');

    if (password !== confirm) {
      setMismatch('Those passwords do not match.');
      return;
    }
    setMismatch(null);

    const result = await submit({ token, password });
    if (result.status === 'success') {
      router.push('/login');
    }
  }

  return (
    <form method="post" onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-bold tracking-tight text-ink">Choose a new password</h1>
        <p className="text-sm text-ink-muted">
          This will sign you out everywhere else, on every device.
        </p>
      </div>

      {state.status === 'error' && state.failure.fields.length === 0 && (
        <InlineError>
          {state.failure.message}{' '}
          <a href="/forgot-password" className="text-accent">
            Request a new link
          </a>
          .
        </InlineError>
      )}

      <Field
        label="New password"
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

      <Field label="Confirm new password" required error={mismatch}>
        {(control) => (
          <Input
            {...control}
            name="confirm"
            type="password"
            autoComplete="new-password"
            minLength={12}
            disabled={submitting}
          />
        )}
      </Field>

      <Button type="submit" size="lg" fullWidth loading={submitting} loadingLabel="Saving">
        Save new password
      </Button>
    </form>
  );
}

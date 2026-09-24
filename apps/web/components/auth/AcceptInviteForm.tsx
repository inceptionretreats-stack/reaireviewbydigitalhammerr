'use client';

import { useRouter } from 'next/navigation';
import { Button, Field, InlineError, Input } from '@ai-review/ui';
import { useFormSubmit } from '../shared/forms/use-form-submit';

/**
 * AMENDMENT-027 — the other end of an admin invitation. One field: the password. The token
 * came in the link; the role and name were fixed by whoever invited. On success the new admin
 * goes straight to authenticator enrolment — there is no state in which an admin has only a
 * password.
 */
export function AcceptInviteForm({ token }: { token: string }) {
  const router = useRouter();
  const { state, submit } = useFormSubmit('/api/v1/auth/invite/accept');
  const submitting = state.status === 'submitting';
  const invalid = state.status === 'error' && state.failure.code === 'INVITE_INVALID';

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await submit({ token, password: String(form.get('password') ?? '') });
    if (result.status === 'success') {
      router.push(
        typeof result.payload.next === 'string' ? result.payload.next : '/login/mfa/enrol',
      );
      router.refresh();
    }
  }

  return (
    <form method="post" onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-bold tracking-tight text-ink">Join the admin team</h1>
        <p className="text-sm text-ink-muted">
          Choose a password. Next you will set up an authenticator app — admin sign-in always needs
          both.
        </p>
      </div>

      {state.status === 'error' && (
        <InlineError>
          {state.failure.message}
          {invalid && ' Ask the admin who invited you to send a new invitation.'}
        </InlineError>
      )}

      <Field label="Password" required hint="At least 12 characters; not a common password.">
        {(control) => (
          <Input
            {...control}
            name="password"
            type="password"
            autoComplete="new-password"
            disabled={submitting || invalid}
          />
        )}
      </Field>

      <Button
        type="submit"
        size="lg"
        fullWidth
        loading={submitting}
        loadingLabel="Creating your account"
        disabled={invalid}
      >
        Continue
      </Button>
    </form>
  );
}

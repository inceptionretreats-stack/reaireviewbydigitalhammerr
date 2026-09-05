'use client';

import { useRouter } from 'next/navigation';
import { Button, Checkbox, Field, InlineError, Input } from '@ai-review/ui';
import { useFormSubmit } from './use-form-submit';

/**
 * AUTH-02. States from the screen spec: default, loading, invalid credentials, locked/rate
 * limited, success.
 *
 * Errors are never attached to a specific field. The server returns one uniform message for a
 * missing account, a wrong password and a locked account alike, so highlighting the email input
 * would tell the visitor something the API deliberately does not — and would be wrong half the
 * time.
 *
 * AUTH-02-03: the destination comes from the server, not from here. A super-admin lands in the
 * admin console and an owner in the dashboard, and the client has no business deciding which.
 */
export function LoginForm() {
  const router = useRouter();
  const { state, submit } = useFormSubmit('/api/v1/auth/login');
  const submitting = state.status === 'submitting';
  const rateLimited = state.status === 'error' && state.failure.code === 'AUTH_RATE_LIMITED';

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

    const result = await submit({
      email: String(form.get('email') ?? ''),
      password: String(form.get('password') ?? ''),
      remember_me: form.get('remember_me') === 'on',
    });

    if (result.status === 'success') {
      const next = typeof result.payload.next === 'string' ? result.payload.next : '/app';
      router.push(next);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-bold tracking-tight text-ink">Sign in</h1>
        <p className="text-sm text-ink-muted">Manage your review page, QR codes and analytics.</p>
      </div>

      {state.status === 'error' && (
        <InlineError>
          {state.failure.message}
          {rateLimited && ' You can also reset your password if you have forgotten it.'}
        </InlineError>
      )}

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

      <Field label="Password" required>
        {(control) => (
          <Input
            {...control}
            name="password"
            type="password"
            autoComplete="current-password"
            disabled={submitting}
          />
        )}
      </Field>

      <Checkbox name="remember_me" disabled={submitting} label="Keep me signed in" />

      <Button type="submit" size="lg" fullWidth loading={submitting} loadingLabel="Signing you in">
        Sign in
      </Button>

      <div className="flex flex-col gap-2 text-center text-sm text-ink-muted">
        <a href="/forgot-password" className="text-accent">
          Forgot your password?
        </a>
        <span>
          New to AI Review?{' '}
          <a href="/signup" className="text-accent">
            Create an account
          </a>
        </span>
      </div>
    </form>
  );
}

'use client';

import { useRouter } from 'next/navigation';
import { Button, Checkbox, Field, InlineError, Input } from '@ai-review/ui';
import { GoogleSignIn } from './GoogleSignIn';
import { useFormSubmit } from '../shared/forms/use-form-submit';

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
export function LoginForm({ googleClientId }: { googleClientId: string | null }) {
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
    <form method="post" onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-bold tracking-tight text-ink">Welcome back</h1>
        <p className="text-sm text-ink-muted">Sign in to manage your review experience.</p>
      </div>

      {googleClientId && (
        <>
          <GoogleSignIn clientId={googleClientId} />
          <p className="text-center text-xs font-medium text-ink-muted">or sign in with email</p>
        </>
      )}

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

      <div className="auth-utility-row">
        <Checkbox name="remember_me" disabled={submitting} label="Keep me signed in" />
        <a href="/forgot-password">Forgot password?</a>
      </div>

      <Button type="submit" size="lg" fullWidth loading={submitting} loadingLabel="Signing you in">
        Sign in
      </Button>

      <p className="auth-switch text-sm text-ink-muted">
        New to Ai Review?{' '}
        <a href="/signup" className="text-accent">
          Create an account
        </a>
      </p>
    </form>
  );
}

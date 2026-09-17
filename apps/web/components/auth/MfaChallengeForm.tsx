'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, Field, InlineError, Input } from '@ai-review/ui';
import { useFormSubmit } from './use-form-submit';

/**
 * AMENDMENT-027 — the second factor after the password.
 *
 * Six digits from the app, or one recovery code when the phone is not to hand. Every failure is
 * the same sentence; the only thing that varies is the Retry-After once the limiter trips. The
 * "Sign out" link matters: a person who cannot pass this screen needs a way to leave it, and a
 * pending session is not one they can do anything else with.
 */
export function MfaChallengeForm({ account }: { account: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<'code' | 'recovery'>('code');
  const challenge = useFormSubmit('/api/v1/auth/mfa/challenge');
  const recovery = useFormSubmit('/api/v1/auth/mfa/recovery');
  const active = mode === 'code' ? challenge : recovery;
  const submitting = active.state.status === 'submitting';

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result =
      mode === 'code'
        ? await challenge.submit({ code: String(form.get('code') ?? '') })
        : await recovery.submit({ recovery_code: String(form.get('recovery_code') ?? '') });
    if (result.status === 'success') {
      const next = typeof result.payload.next === 'string' ? result.payload.next : '/admin';
      router.push(next);
      router.refresh();
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-bold tracking-tight text-ink">Confirm it is you</h1>
        <p className="text-sm text-ink-muted">
          {mode === 'code'
            ? `Enter the 6-digit code from your authenticator app for ${account}.`
            : 'Enter one of the recovery codes you saved when you set up your authenticator app. Each works once.'}
        </p>
      </div>

      {active.state.status === 'error' && (
        <InlineError>
          {active.state.failure.message}
          {active.state.failure.code === 'AUTH_RATE_LIMITED' &&
            active.state.failure.retryAfterSeconds &&
            ` Try again in about ${Math.ceil(active.state.failure.retryAfterSeconds / 60)} minute(s).`}
        </InlineError>
      )}

      {mode === 'code' ? (
        <Field label="Authenticator code" required>
          {(control) => (
            <Input
              {...control}
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={7}
              placeholder="123 456"
              disabled={submitting}
              autoFocus
            />
          )}
        </Field>
      ) : (
        <Field label="Recovery code" required hint="Looks like ABCDE-FGHJK.">
          {(control) => (
            <Input
              {...control}
              name="recovery_code"
              autoComplete="off"
              spellCheck={false}
              maxLength={11}
              placeholder="ABCDE-FGHJK"
              disabled={submitting}
              autoFocus
            />
          )}
        </Field>
      )}

      <Button type="submit" size="lg" fullWidth loading={submitting} loadingLabel="Checking">
        {mode === 'code' ? 'Continue' : 'Use recovery code'}
      </Button>

      <div className="auth-utility-row">
        <button
          type="button"
          className="text-sm text-accent underline-offset-2 hover:underline"
          onClick={() => {
            setMode(mode === 'code' ? 'recovery' : 'code');
            challenge.reset();
            recovery.reset();
          }}
          disabled={submitting}
        >
          {mode === 'code' ? 'Use a recovery code instead' : 'Use the authenticator app'}
        </button>
        <a href="/api/v1/auth/logout" onClick={signOut}>
          Sign out
        </a>
      </div>
    </form>
  );
}

async function signOut(event: React.MouseEvent<HTMLAnchorElement>) {
  event.preventDefault();
  await fetch('/api/v1/auth/logout', { method: 'POST' });
  window.location.assign('/login');
}

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Checkbox, Field, InlineError, Input } from '@ai-review/ui';
import { fieldError, useFormSubmit } from '../shared/forms/use-form-submit';

interface PendingGoogleAccount {
  flowId: string;
  email: string;
  fullName: string;
  flow: 'signup' | 'link';
}

function isPending(value: unknown): value is PendingGoogleAccount {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.flowId === 'string' &&
    /^[A-Za-z0-9_-]{32}$/.test(candidate.flowId) &&
    typeof candidate.email === 'string' &&
    typeof candidate.fullName === 'string' &&
    (candidate.flow === 'signup' || candidate.flow === 'link')
  );
}

/** Completes Google identity without changing the ordinary business onboarding. */
export function GoogleFinishForm() {
  const router = useRouter();
  const [pending, setPending] = useState<PendingGoogleAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingError, setPendingError] = useState<string | null>(null);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [termsError, setTermsError] = useState<string | null>(null);
  const completion = useFormSubmit('/api/v1/auth/google/complete');
  const linking = useFormSubmit('/api/v1/auth/google/link');
  const state = pending?.flow === 'link' ? linking.state : completion.state;
  const busy = state.status === 'submitting';

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const response = await fetch('/api/v1/auth/google/pending', {
          credentials: 'same-origin',
          cache: 'no-store',
        });
        const body: unknown = await response.json();
        if (!response.ok || !isPending(body)) throw new Error('No pending Google account');
        if (mounted) setPending(body);
      } catch {
        if (mounted) {
          setPendingError('Your Google sign-in has expired. Start again to continue safely.');
        }
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pending) return;
    const form = new FormData(event.currentTarget);

    if (pending.flow === 'signup' && !acceptedTerms) {
      setTermsError('Please accept the terms to continue.');
      return;
    }
    setTermsError(null);

    const result =
      pending.flow === 'link'
        ? await linking.submit({
            flow_id: pending.flowId,
            password: String(form.get('password') ?? ''),
          })
        : await completion.submit({
            flow_id: pending.flowId,
            full_name: String(form.get('full_name') ?? ''),
            mobile: String(form.get('mobile') ?? ''),
            accept_terms: true,
          });

    if (result.status === 'success') {
      const next = result.payload.next;
      if (next === '/app' || next === '/onboarding/business') {
        router.push(next);
      }
    }
  }

  if (loading) {
    return (
      <p className="text-sm text-ink-muted" role="status">
        Preparing your Google account…
      </p>
    );
  }

  if (!pending) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-bold tracking-tight text-ink">Start again with Google</h1>
        <InlineError>{pendingError ?? 'Your Google sign-in could not be completed.'}</InlineError>
        <a
          href="/signup"
          className="text-sm font-semibold text-accent underline underline-offset-4"
        >
          Return to sign up
        </a>
      </div>
    );
  }

  const linkingExisting = pending.flow === 'link';
  return (
    <form method="post" onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-bold tracking-tight text-ink">
          {linkingExisting ? 'Connect your existing account' : 'Finish creating your account'}
        </h1>
        <p className="text-sm text-ink-muted">
          {linkingExisting
            ? 'This email already has a vendor account. Enter its current password once to connect Google without changing your business setup.'
            : 'Your Google account is confirmed. Add your mobile number, then set up your business as usual.'}
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
        <span className="block text-xs font-medium text-ink-muted">Google account</span>
        <span className="block break-all text-sm font-semibold text-ink">{pending.email}</span>
      </div>

      {state.status === 'error' && state.failure.fields.length === 0 && (
        <InlineError>{state.failure.message}</InlineError>
      )}

      {linkingExisting ? (
        <Field label="Existing account password" required error={fieldError(state, 'password')}>
          {(control) => (
            <Input
              {...control}
              name="password"
              type="password"
              autoComplete="current-password"
              disabled={busy}
            />
          )}
        </Field>
      ) : (
        <>
          <Field label="Your name" required error={fieldError(state, 'full_name')}>
            {(control) => (
              <Input
                {...control}
                name="full_name"
                defaultValue={pending.fullName}
                autoComplete="name"
                minLength={2}
                maxLength={80}
                disabled={busy}
              />
            )}
          </Field>

          <Field
            label="Mobile number"
            required
            error={fieldError(state, 'mobile')}
            hint="10 digits."
          >
            {(control) => (
              <Input
                {...control}
                name="mobile"
                type="tel"
                autoComplete="tel"
                inputMode="tel"
                disabled={busy}
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
            disabled={busy}
            label={
              <span>
                I accept the{' '}
                <a
                  href="/legal/terms"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent underline underline-offset-4"
                >
                  terms of service
                </a>{' '}
                and{' '}
                <a
                  href="/legal/privacy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent underline underline-offset-4"
                >
                  privacy policy
                </a>
              </span>
            }
          />
        </>
      )}

      <Button
        type="submit"
        size="lg"
        fullWidth
        loading={busy}
        loadingLabel={linkingExisting ? 'Connecting Google' : 'Creating your account'}
      >
        {linkingExisting ? 'Connect Google and sign in' : 'Continue to business setup'}
      </Button>
      <p className="text-center text-sm text-ink-muted">
        <a
          href={linkingExisting ? '/login' : '/signup'}
          className="text-accent underline underline-offset-4"
        >
          {linkingExisting ? 'Sign in with password instead' : 'Use email and password instead'}
        </a>
      </p>
    </form>
  );
}

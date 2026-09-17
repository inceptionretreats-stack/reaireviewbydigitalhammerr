'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button, Checkbox, Field, InlineError, Input } from '@ai-review/ui';
import { useFormSubmit } from './use-form-submit';

/**
 * AMENDMENT-027 — first-time enrolment, forced for every admin role.
 *
 * Step 1 fetches a pending secret and shows it as a QR (and as a manual key, for a phone that
 * cannot scan its own screen); the first correct code arms it. Step 2 shows the eight recovery
 * codes exactly once — they are hashed on the server the moment they are issued — and will not
 * let the person continue until they say they have kept them.
 */

interface Enrolment {
  qr_data_uri: string;
  manual_key: string;
  account: string;
}

export function MfaEnrolWizard() {
  const router = useRouter();
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [next, setNext] = useState('/admin');
  const [kept, setKept] = useState(false);
  const [copied, setCopied] = useState(false);
  const confirm = useFormSubmit('/api/v1/auth/mfa/enrol/confirm');
  const submitting = confirm.state.status === 'submitting';

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const response = await fetch('/api/v1/auth/mfa/enrol', { method: 'POST' });
      if (cancelled) return;
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: { code?: string; message?: string };
        };
        if (body.error?.code === 'AUTH_MFA_ALREADY_ENROLLED') {
          router.replace('/login/mfa');
          return;
        }
        setLoadError(body.error?.message ?? 'Could not start setup. Refresh and try again.');
        return;
      }
      setEnrolment((await response.json()) as Enrolment);
    })().catch(() => setLoadError('Could not reach the server. Refresh and try again.'));
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function onConfirm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await confirm.submit({ code: String(form.get('code') ?? '') });
    if (result.status === 'success') {
      const codes = result.payload.recovery_codes;
      setRecoveryCodes(Array.isArray(codes) ? codes.map(String) : []);
      if (typeof result.payload.next === 'string') setNext(result.payload.next);
    }
  }

  if (recoveryCodes) {
    const sheet = recoveryCodes.join('\n');
    return (
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-2xl font-bold tracking-tight text-ink">Save your recovery codes</h1>
          <p className="text-sm text-ink-muted">
            If you lose your phone, one of these signs you in instead. Each works once, and this is
            the only time they are shown.
          </p>
        </div>
        <ol
          className="grid grid-cols-2 gap-2 rounded-control border border-line bg-surface p-4 font-mono text-sm"
          aria-label="Recovery codes"
        >
          {recoveryCodes.map((code) => (
            <li key={code}>{code}</li>
          ))}
        </ol>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(sheet);
                setCopied(true);
              } catch {
                setCopied(false);
              }
            }}
          >
            {copied ? 'Copied' : 'Copy all'}
          </Button>
          <a
            className="inline-flex min-h-11 items-center rounded-control border border-line px-4 text-sm font-semibold text-ink"
            href={`data:text/plain;charset=utf-8,${encodeURIComponent(`Ai Review admin recovery codes\n\n${sheet}\n`)}`}
            download="ai-review-recovery-codes.txt"
          >
            Download .txt
          </a>
        </div>
        <Checkbox
          name="kept"
          label="I have stored these somewhere safe"
          checked={kept}
          onChange={(event) => setKept(event.target.checked)}
        />
        <Button
          type="button"
          size="lg"
          fullWidth
          disabled={!kept}
          onClick={() => {
            router.push(next);
            router.refresh();
          }}
        >
          Continue to admin
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={onConfirm} noValidate className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-bold tracking-tight text-ink">Set up your authenticator</h1>
        <p className="text-sm text-ink-muted">
          Admin sign-in always needs a code from an authenticator app (Google Authenticator, Authy,
          1Password…). Scan this with the app, then enter the code it shows.
        </p>
      </div>

      {loadError && <InlineError>{loadError}</InlineError>}

      {enrolment ? (
        <div className="flex flex-col items-center gap-3 rounded-control border border-line bg-surface p-4">
          <img
            src={enrolment.qr_data_uri}
            alt={`QR code to add ${enrolment.account} to your authenticator app`}
            width={200}
            height={200}
          />
          <p className="text-center text-xs text-ink-muted">
            Can&apos;t scan? Enter this key by hand:
            <br />
            <code className="text-sm text-ink" data-testid="mfa-manual-key">
              {enrolment.manual_key}
            </code>
          </p>
        </div>
      ) : (
        !loadError && <p className="text-sm text-ink-muted">Preparing your code…</p>
      )}

      {confirm.state.status === 'error' && (
        <InlineError>{confirm.state.failure.message}</InlineError>
      )}

      <Field label="Code from the app" required>
        {(control) => (
          <Input
            {...control}
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={7}
            placeholder="123 456"
            disabled={submitting || !enrolment}
          />
        )}
      </Field>

      <Button
        type="submit"
        size="lg"
        fullWidth
        loading={submitting}
        loadingLabel="Checking"
        disabled={!enrolment}
      >
        Turn on
      </Button>

      <div className="auth-utility-row">
        <span />
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

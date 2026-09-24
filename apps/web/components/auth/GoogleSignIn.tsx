'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Script from 'next/script';
import { InlineError } from '@ai-review/ui';
import { claimGoogleCredential, type GoogleSubmissionPhase } from './google-submission-guard';
import { useFormSubmit } from '../shared/forms/use-form-submit';

interface GoogleIdentityApi {
  accounts: {
    id: {
      initialize: (settings: {
        client_id: string;
        callback: (response: { credential: string }) => void;
        nonce: string;
        auto_select: false;
        ux_mode: 'popup';
      }) => void;
      renderButton: (
        element: HTMLElement,
        settings: {
          type: 'standard';
          theme: 'outline';
          size: 'large';
          shape: 'rectangular';
          text: 'continue_with';
          logo_alignment: 'left';
          width: number;
        },
      ) => void;
    };
  };
}

function googleIdentity(): GoogleIdentityApi | undefined {
  return (window as Window & { google?: GoogleIdentityApi }).google;
}

/** The official GIS button supplies an ID token; our own server creates the ordinary vendor session. */
export function GoogleSignIn({ clientId }: { clientId: string }) {
  const router = useRouter();
  const buttonHost = useRef<HTMLDivElement>(null);
  const preparing = useRef(false);
  const submissionPhase = useRef<GoogleSubmissionPhase>('preparing');
  const resizeObserver = useRef<ResizeObserver | null>(null);
  const { state, submit } = useFormSubmit('/api/v1/auth/google');
  const [ready, setReady] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);

  const receiveCredential = useCallback(
    async ({ credential }: { credential: string }) => {
      if (!claimGoogleCredential(submissionPhase)) return;
      if (!credential) {
        submissionPhase.current = 'preparing';
        buttonHost.current?.replaceChildren();
        setReady(false);
        setSetupError('Google did not return a sign-in credential. Please try again.');
        return;
      }

      resizeObserver.current?.disconnect();
      buttonHost.current?.replaceChildren();
      setReady(false);
      const result = await submit({ credential });
      if (result.status === 'success') {
        const next = result.payload.next;
        // The server is the only authority for the destination; do not accept an arbitrary URL.
        if (next === '/signup/google' || next === '/onboarding/business' || next === '/app') {
          submissionPhase.current = 'complete';
          router.push(next);
        } else {
          submissionPhase.current = 'preparing';
          setSetupError('Google sign-in completed, but the next step was unclear. Please retry.');
        }
      } else {
        // The error effect obtains a new nonce before the GIS button can accept another callback.
        submissionPhase.current = 'preparing';
      }
    },
    [router, submit],
  );

  const prepare = useCallback(async () => {
    // Script onReady can fire again during dev hydration/HMR; keep the same nonce/button until
    // a failed credential actually requires a fresh challenge.
    if (
      preparing.current ||
      submissionPhase.current === 'ready' ||
      submissionPhase.current === 'submitting' ||
      submissionPhase.current === 'complete'
    )
      return;
    preparing.current = true;
    submissionPhase.current = 'preparing';
    const google = googleIdentity();
    const host = buttonHost.current;
    setReady(false);
    host?.replaceChildren();
    if (!google || !host) {
      setSetupError('Google sign-in could not load. You can still use email and password.');
      preparing.current = false;
      return;
    }

    try {
      const response = await fetch('/api/v1/auth/google/challenge', {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      const data: unknown = await response.json();
      const nonce =
        typeof data === 'object' && data !== null && 'nonce' in data
          ? (data as { nonce: unknown }).nonce
          : null;
      if (!response.ok || typeof nonce !== 'string' || nonce.length < 20) {
        throw new Error('No nonce');
      }

      google.accounts.id.initialize({
        client_id: clientId,
        callback: (result) => void receiveCredential(result),
        nonce,
        auto_select: false,
        ux_mode: 'popup',
      });

      resizeObserver.current?.disconnect();
      let lastWidth = -1;
      const render = () => {
        const width = Math.max(200, Math.min(400, Math.floor(host.getBoundingClientRect().width)));
        if (width === lastWidth) return;
        lastWidth = width;
        host.replaceChildren();
        google.accounts.id.renderButton(host, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          shape: 'rectangular',
          text: 'continue_with',
          logo_alignment: 'left',
          width,
        });
      };
      render();
      if (typeof ResizeObserver !== 'undefined') {
        resizeObserver.current = new ResizeObserver(render);
        resizeObserver.current.observe(host);
      }
      setReady(true);
      setSetupError(null);
      submissionPhase.current = 'ready';
    } catch {
      setSetupError(
        'Google sign-in is temporarily unavailable. You can still use email and password.',
      );
    } finally {
      preparing.current = false;
    }
  }, [clientId, receiveCredential]);

  // The nonce is consumed by the server on every attempt. A failed attempt needs a new one.
  useEffect(() => {
    if (state.status === 'error') void prepare();
  }, [prepare, state.status]);

  useEffect(() => () => resizeObserver.current?.disconnect(), []);

  return (
    <div className="flex flex-col gap-3">
      <Script
        src="https://accounts.google.com/gsi/client"
        strategy="afterInteractive"
        onReady={() => void prepare()}
        onError={() =>
          setSetupError('Google sign-in could not load. You can still use email and password.')
        }
      />
      <div
        ref={buttonHost}
        className="flex min-h-11 w-full justify-center"
        aria-label="Continue with Google"
      />
      {!ready && !setupError && state.status !== 'submitting' && state.status !== 'success' && (
        <p className="text-center text-xs text-ink-muted">Loading Google sign-in…</p>
      )}
      {state.status === 'submitting' && (
        <p className="text-center text-xs text-ink-muted" role="status">
          Checking your Google account…
        </p>
      )}
      {setupError && (
        <div className="flex flex-col gap-2">
          <InlineError>{setupError}</InlineError>
          <button
            type="button"
            className="self-center text-sm font-semibold text-accent underline underline-offset-4"
            onClick={() => void prepare()}
          >
            Retry Google sign-in
          </button>
        </div>
      )}
      {state.status === 'error' && <InlineError>{state.failure.message}</InlineError>}
    </div>
  );
}

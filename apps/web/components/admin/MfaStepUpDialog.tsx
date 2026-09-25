'use client';

import { useState } from 'react';
import { Button, Field, InlineError, Input, Modal } from '@ai-review/ui';
import { sendJson, type JsonResult } from '@/components/shared/forms/send-json';

/**
 * AMENDMENT-027 — step-up for a high-risk admin action.
 *
 * A route guarded with `requireAdmin({ stepUp: true })` answers AUTH_MFA_STEP_UP_REQUIRED when
 * the session's last code is older than fifteen minutes. `withStepUp` wraps a call: on that
 * answer it asks for a fresh code (the same challenge endpoint re-stamps the session), then
 * retries the original call once. Everything else passes straight through.
 */

export function isStepUpRequired(result: JsonResult): boolean {
  return !result.ok && result.failure.code === 'AUTH_MFA_STEP_UP_REQUIRED';
}

export interface StepUpController {
  /** Runs the call; if the server demands a fresh code, prompts and retries. */
  run(call: () => Promise<JsonResult>): Promise<JsonResult>;
  /** Render this once, anywhere inside the same client tree. */
  dialog: React.ReactNode;
}

export function useStepUp(): StepUpController {
  const [pending, setPending] = useState<{ resolve: (ok: boolean) => void } | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ask = () =>
    new Promise<boolean>((resolve) => {
      setCode('');
      setError(null);
      setPending({ resolve });
    });

  const close = (ok: boolean) => {
    pending?.resolve(ok);
    setPending(null);
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    const result = await sendJson('/api/v1/auth/mfa/challenge', 'POST', { code });
    setBusy(false);
    if (!result.ok) {
      setError(result.failure.message);
      return;
    }
    close(true);
  };

  const run = async (call: () => Promise<JsonResult>): Promise<JsonResult> => {
    const first = await call();
    if (!isStepUpRequired(first)) return first;
    const verified = await ask();
    if (!verified) return first;
    return call();
  };

  const dialog = (
    <Modal
      open={pending !== null}
      onClose={() => close(false)}
      title="Confirm it is still you"
      description="This action needs a fresh code from your authenticator app."
      footer={
        <>
          <Button variant="secondary" onClick={() => close(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={() => void confirm()}
            loading={busy}
            disabled={code.replace(/\s/g, '').length !== 6}
          >
            Confirm
          </Button>
        </>
      }
    >
      <Field label="Authenticator code" required error={error}>
        {(control) => (
          <Input
            {...control}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={7}
            placeholder="123 456"
            autoFocus
          />
        )}
      </Field>
      {error && <InlineError>{error}</InlineError>}
    </Modal>
  );

  return { run, dialog };
}

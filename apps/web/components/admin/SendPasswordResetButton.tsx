'use client';

import { useState } from 'react';
import { Button, Field, InlineError, Modal, Textarea } from '@ai-review/ui';
import { sendJson } from '@/components/shared/forms/send-json';

/** Owner & account tab: the forgot-password email, sent by an admin, with a reason on record. */
export function SendPasswordResetButton({
  businessId,
  email,
}: {
  businessId: string;
  email: string;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const result = await sendJson(`/api/v1/admin/businesses/${businessId}`, 'PATCH', {
      action: 'send_password_reset',
      reason: reason.trim(),
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.failure.message);
      return;
    }
    const sent = (result.payload as Record<string, unknown>)['email_sent'] === true;
    setNotice(
      sent
        ? `Reset link sent to ${email}. It works for one hour.`
        : 'Recorded, but no email service is configured on this deployment, so nothing was sent.',
    );
    setOpen(false);
    setReason('');
  };

  return (
    <div className="stack">
      {notice && (
        <p role="status" className="text-sm text-success">
          {notice}
        </p>
      )}
      <div>
        <Button variant="secondary" onClick={() => setOpen(true)}>
          Send password reset email
        </Button>
      </div>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Send a password reset link"
        description={`Emails ${email} a link that works for one hour, exactly as the forgot-password screen would.`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              onClick={() => void submit()}
              loading={busy}
              disabled={reason.trim().length < 3}
            >
              Send reset link
            </Button>
          </>
        }
      >
        <Field label="Reason" required hint="Written to the audit log.">
          {(control) => (
            <Textarea
              {...control}
              rows={3}
              maxLength={1000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          )}
        </Field>
        {error && <InlineError>{error}</InlineError>}
      </Modal>
    </div>
  );
}

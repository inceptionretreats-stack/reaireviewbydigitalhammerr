'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, Field, InlineError, Input, Modal, Textarea } from '@ai-review/ui';
import { sendJson } from '@/components/shared/forms/send-json';

/**
 * AMENDMENT-030 — the admin's answers to an abuse signal: warn (an email), suspend Ai,
 * throttle, and their reversals. Each asks for a reason, like every other admin action; the
 * confirm button says what will happen to the customer's experience in plain words.
 */
type Kind = 'warn' | 'suspend_ai' | 'restore_ai' | 'throttle' | 'unthrottle';

const SPEC: Record<
  Kind,
  {
    label: string;
    title: string;
    description: string;
    confirm: string;
    variant: 'primary' | 'secondary' | 'destructive';
  }
> = {
  warn: {
    label: 'Send a warning',
    title: 'Warn the owner by email',
    description:
      'Nothing changes for the business; the owner gets your message and this is written to the audit log.',
    confirm: 'Send warning',
    variant: 'secondary',
  },
  suspend_ai: {
    label: 'Suspend Ai',
    title: 'Stop Ai drafting for this business',
    description:
      'Customers still reach the page and the Google button; the draft button shows a safe notice instead of writing. The owner is not told automatically — send a warning if they should be.',
    confirm: 'Suspend Ai',
    variant: 'destructive',
  },
  restore_ai: {
    label: 'Restore Ai',
    title: 'Turn Ai drafting back on',
    description: 'Drafting resumes immediately under the usual allowance.',
    confirm: 'Restore Ai',
    variant: 'primary',
  },
  throttle: {
    label: 'Throttle',
    title: 'Limit Ai drafts per hour',
    description:
      'Beyond the limit, customers see the usual "try again shortly" notice. Lifts itself when the period ends.',
    confirm: 'Apply throttle',
    variant: 'secondary',
  },
  unthrottle: {
    label: 'Remove throttle',
    title: 'Remove the hourly limit',
    description: 'The business goes back to the usual allowance.',
    confirm: 'Remove throttle',
    variant: 'primary',
  },
};

export function AbuseActions({
  businessId,
  aiSuspended,
  throttled,
  ownerEmail,
}: {
  businessId: string;
  aiSuspended: boolean;
  throttled: boolean;
  ownerEmail: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<Kind | null>(null);
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const [perHour, setPerHour] = useState('20');
  const [hours, setHours] = useState('24');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const available: Kind[] = [
    'warn',
    aiSuspended ? 'restore_ai' : 'suspend_ai',
    throttled ? 'unthrottle' : 'throttle',
  ];

  const submit = async () => {
    if (!open) return;
    setBusy(true);
    setError(null);
    const body: Record<string, unknown> = { action: open, reason: reason.trim() };
    if (open === 'warn') body['message'] = message.trim();
    if (open === 'throttle') {
      body['per_hour'] = Number(perHour);
      body['hours'] = Number(hours);
    }
    const result = await sendJson(`/api/v1/admin/businesses/${businessId}`, 'PATCH', body);
    setBusy(false);
    if (!result.ok) {
      setError(result.failure.message);
      return;
    }
    const payload = result.payload as Record<string, unknown>;
    setNotice(
      open === 'warn'
        ? payload['email_sent'] === true
          ? `Warning sent to ${ownerEmail} and recorded.`
          : 'Warning recorded; no email service is configured, so nothing was sent.'
        : `${SPEC[open].confirm}: done.`,
    );
    setOpen(null);
    setReason('');
    setMessage('');
    router.refresh();
  };

  const canSubmit =
    reason.trim().length >= 3 &&
    (open !== 'warn' || message.trim().length >= 10) &&
    (open !== 'throttle' || (Number(perHour) >= 1 && Number(hours) >= 1));

  return (
    <div className="stack">
      {notice && (
        <p
          role="status"
          className="rounded-card border border-success bg-success-soft px-3 py-2 text-sm text-success"
        >
          {notice}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {available.map((k) => (
          <Button key={k} variant={SPEC[k].variant} onClick={() => setOpen(k)}>
            {SPEC[k].label}
          </Button>
        ))}
      </div>
      <Modal
        open={open !== null}
        onClose={() => setOpen(null)}
        title={open ? SPEC[open].title : ''}
        description={open ? SPEC[open].description : undefined}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              onClick={() => void submit()}
              loading={busy}
              disabled={!canSubmit}
              variant={open ? SPEC[open].variant : 'primary'}
            >
              {open ? SPEC[open].confirm : ''}
            </Button>
          </>
        }
      >
        <div className="stack">
          {open === 'warn' && (
            <Field
              label={`Message to ${ownerEmail}`}
              required
              hint="Sent as written, with a note to reply if they think it is a mistake."
            >
              {(control) => (
                <Textarea
                  {...control}
                  rows={4}
                  maxLength={1000}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                />
              )}
            </Field>
          )}
          {open === 'throttle' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Drafts per hour" required>
                {(control) => (
                  <Input
                    {...control}
                    type="number"
                    inputMode="numeric"
                    min="1"
                    max="10000"
                    value={perHour}
                    onChange={(e) => setPerHour(e.target.value)}
                  />
                )}
              </Field>
              <Field label="For how many hours" required>
                {(control) => (
                  <Input
                    {...control}
                    type="number"
                    inputMode="numeric"
                    min="1"
                    max="744"
                    value={hours}
                    onChange={(e) => setHours(e.target.value)}
                  />
                )}
              </Field>
            </div>
          )}
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
        </div>
      </Modal>
    </div>
  );
}

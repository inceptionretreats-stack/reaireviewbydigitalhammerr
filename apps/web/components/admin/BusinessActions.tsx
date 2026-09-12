'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, Card, Field, InlineError, Input, Modal, Textarea } from '@ai-review/ui';
import { sendJson } from '@/components/dashboard/ai/send-json';

/**
 * ADMIN-02 actions: every one opens a dialog that asks for a reason before it does anything.
 *
 * The reason field is not decoration. RBAC rule 5 makes it mandatory for high-risk actions,
 * the API answers ADMIN_REASON_REQUIRED without one, and the audit row is what a later
 * question ("why is this business on Pro?") gets answered from. So the dialog does not offer a
 * way to skip it, and the confirm button says what will happen in plain words.
 */

type ActionKind =
  | 'activate_pro'
  | 'revoke_pro'
  | 'adjust_free_quota'
  | 'reset_free_usage'
  | 'suspend'
  | 'reactivate';

interface ActionSpec {
  kind: ActionKind;
  label: string;
  title: string;
  description: string;
  confirm: string;
  variant: 'primary' | 'secondary' | 'destructive';
}

const ACTIONS: Record<ActionKind, ActionSpec> = {
  activate_pro: {
    kind: 'activate_pro',
    label: 'Activate or extend Pro',
    title: 'Put this business on Pro',
    description:
      'Grants a paid-plan year without a payment. If the business is already on Pro, the new period starts when the current one ends. Shown to you as "granted by admin", never as paid.',
    confirm: 'Activate Pro',
    variant: 'primary',
  },
  revoke_pro: {
    kind: 'revoke_pro',
    label: 'Revoke Pro',
    title: 'Take Pro away',
    description:
      'The business drops back to whatever free allowance it has left. Its payment history and dates are kept.',
    confirm: 'Revoke Pro',
    variant: 'destructive',
  },
  adjust_free_quota: {
    kind: 'adjust_free_quota',
    label: 'Change free allowance',
    title: 'Change the lifetime free allowance',
    description: 'Cannot go below what the business has already used — reset usage first for that.',
    confirm: 'Save allowance',
    variant: 'secondary',
  },
  reset_free_usage: {
    kind: 'reset_free_usage',
    label: 'Reset free usage to 0',
    title: 'Reset free usage',
    description: 'The free counter goes back to zero. The allowance itself does not change.',
    confirm: 'Reset usage',
    variant: 'secondary',
  },
  suspend: {
    kind: 'suspend',
    label: 'Suspend',
    title: 'Suspend this business',
    description:
      'Its public page and QR codes show "not available", and no Ai drafts are written — whatever it has paid. Reversible.',
    confirm: 'Suspend',
    variant: 'destructive',
  },
  reactivate: {
    kind: 'reactivate',
    label: 'Reactivate',
    title: 'Reactivate this business',
    description: 'Its page, QR codes and Ai drafts come back exactly as they were.',
    confirm: 'Reactivate',
    variant: 'primary',
  },
};

export interface BusinessActionsProps {
  businessId: string;
  status: string;
  plan: 'FREE' | 'PRO';
  freeLimit: number;
  freeUsed: number;
}

export function BusinessActions({
  businessId,
  status,
  plan,
  freeLimit,
  freeUsed,
}: BusinessActionsProps) {
  const router = useRouter();
  const [open, setOpen] = useState<ActionKind | null>(null);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [months, setMonths] = useState('12');
  const [limit, setLimit] = useState(String(freeLimit));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const spec = open ? ACTIONS[open] : null;

  const close = () => {
    setOpen(null);
    setReason('');
    setNote('');
    setError(null);
  };

  const submit = async () => {
    if (!open) return;
    setBusy(true);
    setError(null);
    const body: Record<string, unknown> = { action: open, reason: reason.trim() };
    if (open === 'activate_pro') {
      body['months'] = Number(months);
      if (note.trim()) body['note'] = note.trim();
    }
    if (open === 'adjust_free_quota') body['free_generation_limit'] = Number(limit);

    const result = await sendJson(`/api/v1/admin/businesses/${businessId}`, 'PATCH', body);
    setBusy(false);
    if (!result.ok) {
      setError(result.failure.message);
      return;
    }
    close();
    router.refresh();
  };

  const offered: ActionKind[] = [
    'activate_pro',
    ...(plan === 'PRO' ? (['revoke_pro'] as const) : []),
    'adjust_free_quota',
    ...(freeUsed > 0 ? (['reset_free_usage'] as const) : []),
    ...(status === 'SUSPENDED' ? (['reactivate'] as const) : (['suspend'] as const)),
  ];

  return (
    <Card
      title="Actions"
      titleAs="h2"
      description="Each one asks for a reason and is written to the audit log."
    >
      <div className="flex flex-wrap gap-2">
        {offered.map((kind) => (
          <Button
            key={kind}
            variant={ACTIONS[kind].variant === 'primary' ? 'primary' : ACTIONS[kind].variant}
            onClick={() => setOpen(kind)}
          >
            {ACTIONS[kind].label}
          </Button>
        ))}
      </div>

      <Modal
        open={spec !== null}
        onClose={close}
        title={spec?.title ?? ''}
        description={spec?.description}
        footer={
          <>
            <Button variant="secondary" onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant={spec?.variant === 'primary' ? 'primary' : (spec?.variant ?? 'primary')}
              onClick={() => void submit()}
              loading={busy}
              disabled={reason.trim().length < 3}
            >
              {spec?.confirm}
            </Button>
          </>
        }
      >
        <div className="stack">
          {open === 'activate_pro' && (
            <>
              <Field
                label="Months of Pro"
                hint="12 is one year. Extending adds to the current period."
              >
                {(control) => (
                  <Input
                    {...control}
                    type="number"
                    min={1}
                    max={60}
                    value={months}
                    onChange={(e) => setMonths(e.target.value)}
                  />
                )}
              </Field>
              <Field label="Note for the record" hint="Optional. Who agreed this, and where.">
                {(control) => (
                  <Input
                    {...control}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    maxLength={500}
                  />
                )}
              </Field>
            </>
          )}
          {open === 'adjust_free_quota' && (
            <Field label="Free allowance (lifetime drafts)" hint={`${freeUsed} used so far.`}>
              {(control) => (
                <Input
                  {...control}
                  type="number"
                  min={freeUsed}
                  max={100000}
                  value={limit}
                  onChange={(e) => setLimit(e.target.value)}
                />
              )}
            </Field>
          )}
          <Field
            label="Reason"
            required
            hint="Written to the audit log with your name and the time."
            error={error}
          >
            {(control) => (
              <Textarea
                {...control}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={1000}
                rows={3}
                placeholder="Launch partner — first year comped, agreed on call with owner."
              />
            )}
          </Field>
          {error && <InlineError>{error}</InlineError>}
        </div>
      </Modal>
    </Card>
  );
}

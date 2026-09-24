'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Badge, Button, Card, Drawer, Field, Input, Modal, Table, Textarea } from '@ai-review/ui';
import { sendJson } from '@/components/shared/forms/send-json';
import { useStepUp } from './MfaStepUpDialog';

/**
 * AMENDMENT-029 — the cross-tenant payments screen: a list, a drawer with everything about one
 * payment, and the four actions. Money leaves only through Refund, which asks for a reason
 * and a fresh MFA code; the other three are audited (reconcile, mark failed) or recorded on
 * the payment (resend receipt). A support viewer sees the list and the drawer with no buttons.
 *
 * Dates arrive pre-formatted from the server in the platform timezone.
 */
export interface PaymentRowView {
  id: string;
  businessId: string;
  businessName: string;
  ownerEmail: string;
  status: string;
  amountLabel: string;
  refundedLabel: string | null;
  refundedPaise: number;
  amountPaise: number;
  providerPaymentId: string | null;
  providerOrderId: string | null;
  invoiceNumber: string | null;
  failureReason: string | null;
  createdLabel: string;
  paidLabel: string | null;
  receiptEmailedLabel: string | null;
  lastWebhook: { event: string; outcome: string | null; label: string } | null;
}

interface Detail {
  refunds: Array<{
    id: string;
    provider_refund_id: string | null;
    amount_paise: number;
    status: string;
    reason: string | null;
    error: string | null;
    created_at: string;
  }>;
  webhooks: Array<{
    id: string;
    event: string;
    outcome: string | null;
    error: string | null;
    created_at: string;
  }>;
  audit: Array<{
    id: number;
    action: string;
    actor: string;
    reason: string | null;
    created_at: string;
  }>;
  funds_current_period: boolean;
  subscription: { status: string; expires_at: string | null } | null;
}

type Dialog =
  | { kind: 'refund'; full: boolean }
  | { kind: 'reconcile' }
  | { kind: 'mark_failed' }
  | { kind: 'resend_receipt' };

export function PaymentsScreen({
  rows,
  nextBefore,
  olderHref,
  canAct,
  paymentsConfigured,
}: {
  rows: PaymentRowView[];
  nextBefore: string | null;
  olderHref: string;
  canAct: boolean;
  paymentsConfigured: boolean;
}) {
  const router = useRouter();
  const stepUp = useStepUp();
  const [open, setOpen] = useState<PaymentRowView | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [reason, setReason] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const show = async (row: PaymentRowView) => {
    setOpen(row);
    setDetail(null);
    setNotice(null);
    const response = await fetch(`/api/v1/admin/payments/${row.id}`);
    if (response.ok) setDetail((await response.json()) as Detail);
  };

  const close = () => {
    setOpen(null);
    setDetail(null);
    setDialog(null);
    setError(null);
  };

  const remaining = open ? open.amountPaise - open.refundedPaise : 0;

  const act = async () => {
    if (!open || !dialog) return;
    setBusy(true);
    setError(null);
    let result;
    if (dialog.kind === 'refund') {
      const body: Record<string, unknown> = { reason: reason.trim() };
      if (!dialog.full) body['amount_paise'] = Math.round(Number(amount) * 100);
      result = await stepUp.run(() =>
        sendJson(`/api/v1/admin/payments/${open.id}/refund`, 'POST', body),
      );
    } else {
      result = await sendJson(`/api/v1/admin/payments/${open.id}/actions`, 'POST', {
        action: dialog.kind,
        reason: reason.trim() || 'Receipt re-sent from the admin panel',
      });
    }
    setBusy(false);
    if (!result.ok) {
      setError(result.failure.message);
      return;
    }
    const payload = result.payload as Record<string, unknown>;
    if (dialog.kind === 'resend_receipt') {
      setNotice(
        payload['sent'] === true
          ? 'Receipt sent.'
          : payload['reason'] === 'not_configured'
            ? 'No email service is configured, so nothing was sent.'
            : 'The receipt could not be sent.',
      );
    } else if (dialog.kind === 'reconcile') {
      setNotice(
        payload['activated'] === true
          ? 'Razorpay had captured this payment; it is now settled and Pro is active.'
          : `Nothing captured at Razorpay yet (last attempt: ${String(payload['provider_status'])}).`,
      );
    } else if (dialog.kind === 'refund') {
      setNotice(
        payload['revoked'] === true
          ? 'Refunded in full; Pro has been revoked.'
          : 'Refund recorded.',
      );
    } else {
      setNotice('Marked failed.');
    }
    setDialog(null);
    setReason('');
    setAmount('');
    router.refresh();
    const response = await fetch(`/api/v1/admin/payments/${open.id}`);
    if (response.ok) setDetail((await response.json()) as Detail);
  };

  const tone = (status: string) =>
    status === 'CAPTURED'
      ? 'success'
      : status === 'FAILED'
        ? 'danger'
        : status === 'REFUNDED'
          ? 'warning'
          : 'neutral';

  const dialogTitle =
    dialog?.kind === 'refund'
      ? dialog.full
        ? 'Refund the full amount'
        : 'Refund part of the payment'
      : dialog?.kind === 'reconcile'
        ? 'Check Razorpay and settle'
        : dialog?.kind === 'mark_failed'
          ? 'Mark this checkout failed'
          : 'Resend the receipt';

  return (
    <>
      {stepUp.dialog}
      <Card title="Payments" titleAs="h2">
        <Table
          caption="Payments"
          columns={[
            { key: 'when', header: 'Started', isRowHeader: true, cell: (r) => r.createdLabel },
            {
              key: 'business',
              header: 'Business',
              cell: (r) => (
                <>
                  <Link href={`/admin/businesses/${r.businessId}`}>{r.businessName}</Link>
                  <span className="block text-xs text-ink-muted">{r.ownerEmail}</span>
                </>
              ),
            },
            { key: 'amount', header: 'Amount', cell: (r) => r.amountLabel },
            {
              key: 'status',
              header: 'Status',
              cell: (r) => (
                <>
                  <Badge tone={tone(r.status)}>{r.status}</Badge>
                  {r.refundedLabel && (
                    <span className="block text-xs text-ink-muted">{r.refundedLabel} refunded</span>
                  )}
                </>
              ),
            },
            {
              key: 'invoice',
              header: 'Invoice',
              cell: (r) =>
                r.invoiceNumber ? (
                  <Link href={`/admin/payments/${r.id}/invoice`} className="font-mono text-xs">
                    {r.invoiceNumber}
                  </Link>
                ) : (
                  '—'
                ),
            },
            {
              key: 'webhook',
              header: 'Last webhook',
              cell: (r) =>
                r.lastWebhook ? (
                  <span className="text-xs">
                    <code>{r.lastWebhook.event}</code>{' '}
                    <Badge
                      tone={
                        r.lastWebhook.outcome === 'processed'
                          ? 'success'
                          : r.lastWebhook.outcome === 'failed'
                            ? 'danger'
                            : 'neutral'
                      }
                    >
                      {r.lastWebhook.outcome ?? 'pending'}
                    </Badge>
                  </span>
                ) : (
                  <span className="text-xs text-ink-muted">none</span>
                ),
            },
            {
              key: 'open',
              header: '',
              cell: (r) => (
                <Button variant="secondary" onClick={() => void show(r)}>
                  Open
                </Button>
              ),
            },
          ]}
          rows={rows}
          rowKey={(r) => r.id}
          stackOnMobile
          empty={<p className="text-sm text-ink-muted">No payments match.</p>}
        />
        {nextBefore && (
          <p className="mt-3">
            <Link href={olderHref} className="text-sm font-medium text-accent">
              Older →
            </Link>
          </p>
        )}
      </Card>

      <Drawer
        open={open !== null}
        onClose={close}
        title={open ? `${open.businessName} — ${open.amountLabel}` : 'Payment'}
        description={open ? `Started ${open.createdLabel}` : undefined}
      >
        {open && (
          <div className="stack text-sm">
            {notice && (
              <p
                role="status"
                className="rounded-card border border-success bg-success-soft px-3 py-2 text-success"
              >
                {notice}
              </p>
            )}
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              <dt className="text-ink-muted">Status</dt>
              <dd>
                <Badge tone={tone(open.status)}>{open.status}</Badge>
                {open.failureReason && (
                  <span className="block text-xs text-ink-muted">{open.failureReason}</span>
                )}
              </dd>
              <dt className="text-ink-muted">Paid</dt>
              <dd>{open.paidLabel ?? '—'}</dd>
              <dt className="text-ink-muted">Refunded</dt>
              <dd>{open.refundedLabel ?? '—'}</dd>
              <dt className="text-ink-muted">Invoice</dt>
              <dd>
                {open.invoiceNumber ? (
                  <Link
                    href={`/admin/payments/${open.id}/invoice`}
                    className="font-mono text-xs text-accent"
                  >
                    {open.invoiceNumber}
                  </Link>
                ) : (
                  '—'
                )}
              </dd>
              <dt className="text-ink-muted">Receipt email</dt>
              <dd>{open.receiptEmailedLabel ? `Sent ${open.receiptEmailedLabel}` : 'Not sent'}</dd>
              <dt className="text-ink-muted">Razorpay</dt>
              <dd className="font-mono text-xs">
                {open.providerPaymentId ?? '—'}
                <span className="block text-ink-muted">order {open.providerOrderId ?? '—'}</span>
              </dd>
              {detail?.subscription && (
                <>
                  <dt className="text-ink-muted">Plan now</dt>
                  <dd>
                    {detail.subscription.status}
                    {detail.funds_current_period && (
                      <span className="block text-xs text-ink-muted">
                        This payment funds the current period — a full refund revokes Pro.
                      </span>
                    )}
                  </dd>
                </>
              )}
            </dl>

            {canAct && (
              <div className="flex flex-wrap gap-2">
                {open.status === 'CAPTURED' && remaining > 0 && (
                  <>
                    <Button
                      variant="destructive"
                      onClick={() => setDialog({ kind: 'refund', full: true })}
                      disabled={!paymentsConfigured}
                    >
                      Refund in full
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => setDialog({ kind: 'refund', full: false })}
                      disabled={!paymentsConfigured}
                    >
                      Refund part
                    </Button>
                  </>
                )}
                {(open.status === 'CREATED' || open.status === 'AUTHORIZED') && (
                  <>
                    <Button variant="secondary" onClick={() => setDialog({ kind: 'reconcile' })}>
                      Check Razorpay
                    </Button>
                    <Button variant="secondary" onClick={() => setDialog({ kind: 'mark_failed' })}>
                      Mark failed
                    </Button>
                  </>
                )}
                {(open.status === 'CAPTURED' || open.status === 'REFUNDED') && (
                  <Button variant="secondary" onClick={() => setDialog({ kind: 'resend_receipt' })}>
                    Resend receipt
                  </Button>
                )}
              </div>
            )}
            {canAct && !paymentsConfigured && open.status === 'CAPTURED' && (
              <p className="text-xs text-ink-muted">
                Refunds need the Razorpay keys on this deployment.
              </p>
            )}

            <section>
              <h3 className="text-xs font-semibold tracking-wider text-ink-muted uppercase">
                Refunds
              </h3>
              {!detail ? (
                <p className="text-ink-muted">Loading…</p>
              ) : detail.refunds.length === 0 ? (
                <p className="text-ink-muted">None.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {detail.refunds.map((r) => (
                    <li key={r.id} className="rounded-card border border-border p-2">
                      <div className="flex items-center justify-between gap-2">
                        <span>₹{(r.amount_paise / 100).toFixed(2)}</span>
                        <Badge
                          tone={
                            r.status === 'PROCESSED'
                              ? 'success'
                              : r.status === 'FAILED'
                                ? 'danger'
                                : 'neutral'
                          }
                        >
                          {r.status}
                        </Badge>
                      </div>
                      <p className="text-xs text-ink-muted">{r.reason}</p>
                      {r.provider_refund_id && (
                        <code className="text-xs">{r.provider_refund_id}</code>
                      )}
                      {r.error && <p className="text-xs text-danger">{r.error}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h3 className="text-xs font-semibold tracking-wider text-ink-muted uppercase">
                Webhooks
              </h3>
              {!detail ? null : detail.webhooks.length === 0 ? (
                <p className="text-ink-muted">None recorded for this payment.</p>
              ) : (
                <ul className="flex flex-col gap-1 text-xs">
                  {detail.webhooks.map((w) => (
                    <li key={w.id} className="flex items-center justify-between gap-2">
                      <code>{w.event}</code>
                      <Badge
                        tone={
                          w.outcome === 'processed'
                            ? 'success'
                            : w.outcome === 'failed'
                              ? 'danger'
                              : 'neutral'
                        }
                      >
                        {w.outcome ?? 'pending'}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h3 className="text-xs font-semibold tracking-wider text-ink-muted uppercase">
                Audit
              </h3>
              {!detail ? null : detail.audit.length === 0 ? (
                <p className="text-ink-muted">No admin action on this payment.</p>
              ) : (
                <ul className="flex flex-col gap-1 text-xs">
                  {detail.audit.map((a) => (
                    <li key={a.id}>
                      <code>{a.action}</code> · {a.actor}
                      {a.reason && <span className="block text-ink-muted">{a.reason}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </Drawer>

      <Modal
        open={dialog !== null}
        onClose={() => setDialog(null)}
        title={dialogTitle}
        description={
          dialog?.kind === 'refund'
            ? `Up to ₹${(remaining / 100).toFixed(2)} can still be refunded. Razorpay returns the money to the same instrument in 5–7 working days.`
            : dialog?.kind === 'reconcile'
              ? 'Asks Razorpay for every payment on this order and settles a captured one exactly as the checkout would.'
              : dialog?.kind === 'mark_failed'
                ? 'For an abandoned checkout. It stops appearing as open; nothing is sent to Razorpay.'
                : 'Emails the invoice to the owner again.'
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setDialog(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              onClick={() => void act()}
              loading={busy}
              variant={dialog?.kind === 'refund' ? 'destructive' : 'primary'}
              disabled={
                (dialog?.kind !== 'resend_receipt' && reason.trim().length < 3) ||
                (dialog?.kind === 'refund' && !dialog.full && !(Number(amount) > 0))
              }
            >
              {dialog?.kind === 'refund'
                ? 'Refund'
                : dialog?.kind === 'reconcile'
                  ? 'Check and settle'
                  : dialog?.kind === 'mark_failed'
                    ? 'Mark failed'
                    : 'Send'}
            </Button>
          </>
        }
      >
        <div className="stack">
          {dialog?.kind === 'refund' && !dialog.full && (
            <Field label="Amount to refund (₹)" required>
              {(control) => (
                <Input
                  {...control}
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="1"
                  max={String(remaining / 100)}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              )}
            </Field>
          )}
          {dialog?.kind !== 'resend_receipt' && (
            <Field label="Reason" required hint="Written to the audit log." error={error}>
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
          )}
          {dialog?.kind === 'resend_receipt' && error && (
            <p className="text-sm text-danger">{error}</p>
          )}
        </div>
      </Modal>
    </>
  );
}

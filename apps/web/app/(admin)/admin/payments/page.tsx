import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { adminPaymentListQuery, adminWebhookQuery } from '@ai-review/contracts';
import { isAdminRole } from '@ai-review/core';
import { Badge, Card, Table } from '@ai-review/ui';
import { PaymentsScreen, type PaymentRowView } from '@/components/admin/payments/PaymentsScreen';
import { PaymentFilters } from '@/components/admin/payments/PaymentFilters';
import { adminDateTime } from '@/lib/admin/format';
import { paymentAdmin, paymentFilterFrom, webhookFilterFrom } from '@/lib/admin/payments';
import { getSession } from '@/lib/auth/session';
import { razorpayConfig } from '@/lib/billing/subscription';
import { formatMoney } from '@/lib/dashboard/presentation';

export const metadata: Metadata = { title: 'Payments | Ai Review admin' };
export const dynamic = 'force-dynamic';

/**
 * AMENDMENT-029 — every tenant's payments and the webhook ledger. Two tabs on one URL so a
 * filtered view can be pasted to a colleague; the drawer and actions are client-side.
 */
export default async function AdminPaymentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (!session || !isAdminRole(session.role)) redirect('/admin');
  const params = await searchParams;
  const one = (key: string) => {
    const v = params[key];
    const s = Array.isArray(v) ? v[0] : v;
    return s && s.trim() ? s.trim() : undefined;
  };
  const tab = one('tab') === 'webhooks' ? 'webhooks' : 'payments';
  const service = paymentAdmin();
  const canAct = session.role === 'SUPER_ADMIN';
  const configured = razorpayConfig() !== null;

  const keep = new URLSearchParams(
    Object.entries(params).flatMap(([k, v]) =>
      typeof v === 'string' && k !== 'before' ? [[k, v]] : [],
    ),
  );

  if (tab === 'webhooks') {
    const parsed = adminWebhookQuery.safeParse({
      outcome: one('outcome'),
      event: one('event'),
      before: one('before'),
    });
    const { rows, nextBefore } = await service.listWebhookEvents(
      webhookFilterFrom(parsed.success ? parsed.data : {}),
    );
    if (nextBefore) keep.set('before', nextBefore);
    return (
      <Shell tab={tab} configured={configured}>
        <Card title="Webhook deliveries" titleAs="h2">
          <Table
            caption="Webhook deliveries"
            columns={[
              {
                key: 'when',
                header: 'Received',
                isRowHeader: true,
                cell: (r) => adminDateTime(r.createdAt),
              },
              { key: 'event', header: 'Event', cell: (r) => <code>{r.eventType}</code> },
              {
                key: 'outcome',
                header: 'Outcome',
                cell: (r) => (
                  <>
                    <Badge
                      tone={
                        r.outcome === 'processed'
                          ? 'success'
                          : r.outcome === 'failed' || r.outcome === 'rejected'
                            ? 'danger'
                            : 'neutral'
                      }
                    >
                      {r.outcome ?? (r.processedAt ? 'done' : 'pending')}
                    </Badge>
                    {r.processingError && (
                      <span className="block text-xs text-ink-muted">{r.processingError}</span>
                    )}
                  </>
                ),
              },
              {
                key: 'business',
                header: 'Business',
                cell: (r) =>
                  r.businessId ? (
                    <Link href={`/admin/businesses/${r.businessId}`}>{r.businessName}</Link>
                  ) : (
                    '—'
                  ),
              },
              {
                key: 'id',
                header: 'Razorpay event',
                cell: (r) => <code className="text-xs">{r.providerEventId ?? '—'}</code>,
              },
            ]}
            rows={rows}
            rowKey={(r) => r.id}
            stackOnMobile
            empty={<p className="text-sm text-ink-muted">No webhook has been received yet.</p>}
          />
          {nextBefore && (
            <p className="mt-3">
              <Link
                href={`/admin/payments?${keep.toString()}`}
                className="text-sm font-medium text-accent"
              >
                Older →
              </Link>
            </p>
          )}
        </Card>
      </Shell>
    );
  }

  const parsed = adminPaymentListQuery.safeParse({
    status: one('status'),
    business: one('business'),
    from: one('from'),
    to: one('to'),
    refunded: one('refunded'),
    before: one('before'),
  });
  const { rows, nextBefore } = await service.list(
    paymentFilterFrom(parsed.success ? parsed.data : {}),
  );
  if (nextBefore) keep.set('before', nextBefore);
  const views: PaymentRowView[] = rows.map((r) => ({
    id: r.id,
    businessId: r.businessId,
    businessName: r.businessName,
    ownerEmail: r.ownerEmail,
    status: r.status,
    amountLabel: formatMoney(r.amountPaise, r.currency),
    refundedLabel: r.refundedPaise > 0 ? formatMoney(r.refundedPaise, r.currency) : null,
    refundedPaise: r.refundedPaise,
    amountPaise: r.amountPaise,
    providerPaymentId: r.providerPaymentId,
    providerOrderId: r.providerOrderId,
    invoiceNumber: r.invoiceNumber,
    failureReason: r.failureReason,
    createdLabel: adminDateTime(r.createdAt),
    paidLabel: r.paidAt ? adminDateTime(r.paidAt) : null,
    receiptEmailedLabel: r.receiptEmailedAt ? adminDateTime(r.receiptEmailedAt) : null,
    lastWebhook: r.lastWebhook
      ? {
          event: r.lastWebhook.eventType,
          outcome: r.lastWebhook.outcome,
          label: adminDateTime(r.lastWebhook.at),
        }
      : null,
  }));

  return (
    <Shell tab={tab} configured={configured}>
      <Card title="Filter" titleAs="h2">
        <PaymentFilters
          values={{
            status: one('status') ?? '',
            business: one('business') ?? '',
            refunded: one('refunded') ?? '',
            from: one('from') ?? '',
            to: one('to') ?? '',
          }}
        />
      </Card>
      <PaymentsScreen
        rows={views}
        nextBefore={nextBefore}
        olderHref={`/admin/payments?${keep.toString()}`}
        canAct={canAct}
        paymentsConfigured={configured}
      />
    </Shell>
  );
}

function Shell({
  tab,
  configured,
  children,
}: {
  tab: 'payments' | 'webhooks';
  configured: boolean;
  children: React.ReactNode;
}) {
  const tabClass = (active: boolean) =>
    `rounded-full px-3 py-1 text-sm font-medium ${active ? 'bg-accent text-white' : 'text-ink-muted hover:text-ink'}`;
  return (
    <div className="stack">
      <div>
        <p className="text-xs font-semibold tracking-wider text-ink-muted uppercase">
          Platform admin
        </p>
        <h1 className="text-2xl font-bold tracking-tight text-ink">Payments</h1>
        <p className="text-sm text-ink-muted">
          Every payment across every business, with its invoice, refunds and what Razorpay told us.{' '}
          {configured
            ? ''
            : 'Razorpay keys are not configured on this deployment — refunds and reconciliation are unavailable until they are.'}
        </p>
      </div>
      <nav aria-label="Payment views" className="flex gap-2">
        <Link
          href="/admin/payments"
          className={tabClass(tab === 'payments')}
          aria-current={tab === 'payments' ? 'page' : undefined}
        >
          Payments
        </Link>
        <Link
          href="/admin/payments?tab=webhooks"
          className={tabClass(tab === 'webhooks')}
          aria-current={tab === 'webhooks' ? 'page' : undefined}
        >
          Webhook ledger
        </Link>
      </nav>
      {children}
    </div>
  );
}

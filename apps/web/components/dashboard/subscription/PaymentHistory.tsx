import Link from 'next/link';
import type { Payment } from '@ai-review/db';
import { Card, EmptyState, Table, type TableColumn } from '@ai-review/ui';
import { formatDate, formatMoney } from '@/components/dashboard/presentation';

/**
 * SUB-01's payment history and receipts (E10-06).
 *
 * Every row is a `payments` record for this business, newest first. A receipt exists only for
 * a payment that was captured: a started or failed attempt has nothing to receipt, and a link
 * on those rows would open a page that says so. A refunded payment keeps its receipt — the
 * sale happened, and the invoice now notes the refund (AMENDMENT-029).
 */

const STATUS_LABEL: Record<Payment['status'], string> = {
  CREATED: 'Started',
  AUTHORIZED: 'Authorised',
  CAPTURED: 'Paid',
  REFUNDED: 'Refunded',
  FAILED: 'Failed',
};

export function describePaymentStatus(status: Payment['status']): string {
  return STATUS_LABEL[status];
}

export interface PaymentHistoryProps {
  payments: Payment[];
  timezone: string;
}

export function PaymentHistory({ payments, timezone }: PaymentHistoryProps) {
  const columns: TableColumn<Payment>[] = [
    {
      key: 'date',
      header: 'Date',
      isRowHeader: true,
      cell: (p) => formatDate(p.paidAt ?? p.createdAt, timezone),
    },
    {
      key: 'amount',
      header: 'Amount',
      align: 'end',
      cell: (p) => <span className="tabular-nums">{formatMoney(p.amountPaise, p.currency)}</span>,
    },
    { key: 'status', header: 'Status', cell: (p) => describePaymentStatus(p.status) },
    {
      key: 'reference',
      header: 'Reference',
      cell: (p) => (
        <span className="font-mono text-xs text-ink-muted">
          {p.providerPaymentId ?? p.providerOrderId ?? '—'}
        </span>
      ),
    },
    {
      key: 'receipt',
      header: 'Invoice',
      cell: (p) =>
        p.status === 'CAPTURED' || p.status === 'REFUNDED' ? (
          <Link
            href={`/app/subscription/receipts/${p.id}`}
            className="text-sm font-medium text-ink underline underline-offset-2"
          >
            {p.invoiceNumber ? (
              <span className="font-mono text-xs">{p.invoiceNumber}</span>
            ) : (
              'Download receipt'
            )}
          </Link>
        ) : (
          <span className="text-ink-muted">—</span>
        ),
    },
  ];

  return (
    <Card title="Payment history" titleAs="h2">
      <Table
        caption="Payments for this business"
        columns={columns}
        rows={payments}
        rowKey={(p) => p.id}
        empty={
          <EmptyState
            title="No payments yet"
            description="Payments made for this business will be listed here, with a receipt for each one."
          />
        }
      />
    </Card>
  );
}

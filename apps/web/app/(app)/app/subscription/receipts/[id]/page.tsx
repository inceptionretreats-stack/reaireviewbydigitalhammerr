import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { businesses, payments, users } from '@ai-review/db';
import { TenantGuard } from '@ai-review/core';
import { Card } from '@ai-review/ui';
import { db } from '@/lib/db';
import { getSession } from '@/lib/session';
import { formatDate, formatMoney } from '@/components/dashboard/presentation';
import { describePaymentStatus } from '@/components/dashboard/subscription/PaymentHistory';
import { PrintButton } from '@/components/dashboard/subscription/PrintButton';
import { InvoiceDocument } from '@/components/billing/InvoiceDocument';
import { invoiceViewFrom } from '@/lib/billing/invoice-view';

/**
 * A receipt for one captured payment (SUB-01 "Download receipt", E10-06).
 *
 * The payment is looked up by id AND by the business the session resolves to, so a receipt id
 * from another tenant is a 404 rather than someone else's invoice (AC-003). Only a captured
 * payment has a receipt; a started or failed attempt 404s too — there is nothing to receipt.
 *
 * AMENDMENT-029: a payment settled since invoicing began carries a numbered invoice with the
 * tax split, and that is what renders. Older captured payments keep the plain receipt below.
 * A refunded payment still shows its invoice, with the refund noted — the sale happened.
 */

export const metadata: Metadata = { title: 'Receipt | Ai Review' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) redirect('/login');
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const database = db();
  const tenant = await new TenantGuard(database).resolveActive(session);
  if (!tenant.ok) notFound();

  const [row] = await database
    .select({
      payment: payments,
      businessName: businesses.name,
      timezone: businesses.timezone,
      ownerName: users.fullName,
      ownerEmail: users.email,
    })
    .from(payments)
    .innerJoin(businesses, eq(businesses.id, payments.businessId))
    .innerJoin(users, eq(users.id, businesses.ownerUserId))
    .where(and(eq(payments.id, id), eq(payments.businessId, tenant.businessId)))
    .limit(1);
  if (!row || (row.payment.status !== 'CAPTURED' && row.payment.status !== 'REFUNDED')) {
    notFound();
  }

  const p = row.payment;
  const invoice = invoiceViewFrom(p);
  if (invoice) {
    return (
      <div className="flex max-w-2xl flex-col gap-6">
        <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
          <div className="flex flex-col gap-2">
            <p className="text-xs font-semibold tracking-wider text-ink-muted uppercase">
              Subscription
            </p>
            <h1 className="text-2xl font-bold tracking-tight text-ink">
              {invoice.tax.gst_applicable ? 'Invoice' : 'Receipt'} {invoice.invoiceNumber}
            </h1>
          </div>
          <div className="flex gap-2">
            <Link
              href="/app/subscription"
              className="inline-flex items-center text-sm font-medium text-ink underline underline-offset-2"
            >
              Back to your plan
            </Link>
            <PrintButton />
          </div>
        </div>
        <InvoiceDocument invoice={invoice} timezone={row.timezone} />
      </div>
    );
  }

  const reference = p.rawReference as Record<string, unknown>;
  const periodStart = isoDate(reference['period_starts_at']);
  const periodEnd = isoDate(reference['period_expires_at']);
  const paidOn = formatDate(p.paidAt ?? p.createdAt, row.timezone);

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold tracking-wider text-ink-muted uppercase">
            Subscription
          </p>
          <h1 className="text-2xl font-bold tracking-tight text-ink">Receipt</h1>
        </div>
        <div className="flex gap-2">
          <Link
            href="/app/subscription"
            className="inline-flex items-center text-sm font-medium text-ink underline underline-offset-2"
          >
            Back to your plan
          </Link>
          <PrintButton />
        </div>
      </div>

      <Card as="article" title="Ai Review — payment receipt" titleAs="h2">
        <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-6 gap-y-2 text-sm">
          <dt className="text-ink-muted">Receipt no.</dt>
          <dd className="font-mono text-ink">{p.id.slice(0, 8).toUpperCase()}</dd>

          <dt className="text-ink-muted">Paid on</dt>
          <dd className="text-ink">{paidOn}</dd>

          <dt className="text-ink-muted">Billed to</dt>
          <dd className="text-ink">
            {row.businessName}
            <br />
            <span className="text-ink-muted">
              {row.ownerName} · {row.ownerEmail}
            </span>
          </dd>

          <dt className="text-ink-muted">Item</dt>
          <dd className="text-ink">
            Ai Review Pro — one year
            {periodStart && periodEnd && (
              <>
                <br />
                <span className="text-ink-muted">
                  {formatDate(periodStart, row.timezone)} to {formatDate(periodEnd, row.timezone)}
                </span>
              </>
            )}
          </dd>

          <dt className="text-ink-muted">Amount</dt>
          <dd className="text-lg font-semibold tabular-nums text-ink">
            {formatMoney(p.amountPaise, p.currency)}
          </dd>

          <dt className="text-ink-muted">Status</dt>
          <dd className="text-ink">{describePaymentStatus(p.status)}</dd>

          <dt className="text-ink-muted">Payment reference</dt>
          <dd className="font-mono text-xs text-ink">
            {p.providerPaymentId ?? '—'}
            {p.providerOrderId && (
              <>
                <br />
                <span className="text-ink-muted">order {p.providerOrderId}</span>
              </>
            )}
          </dd>
        </dl>
        <p className="mt-4 text-xs text-ink-muted">
          Paid through Razorpay. Issued by Digital Hammerr for Ai Review. Keep this receipt for your
          records.
        </p>
      </Card>
    </div>
  );
}

function isoDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

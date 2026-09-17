import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { businesses, payments } from '@ai-review/db';
import { isAdminRole } from '@ai-review/core';
import { InvoiceDocument } from '@/components/billing/InvoiceDocument';
import { PrintButton } from '@/components/dashboard/subscription/PrintButton';
import { db } from '@/lib/db';
import { invoiceViewFrom } from '@/lib/billing/invoice-view';
import { getSession } from '@/lib/session';

export const metadata: Metadata = { title: 'Invoice | Ai Review admin' };
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * AMENDMENT-029 — the same document the owner sees, for support and the accountant. Read-only,
 * so a support viewer may open it; the admin layout has already insisted on MFA.
 */
export default async function AdminInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !isAdminRole(session.role)) redirect('/admin');
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const [row] = await db()
    .select({ payment: payments, businessName: businesses.name, timezone: businesses.timezone })
    .from(payments)
    .innerJoin(businesses, eq(businesses.id, payments.businessId))
    .where(eq(payments.id, id))
    .limit(1);
  if (!row) notFound();
  const invoice = invoiceViewFrom(row.payment);
  if (!invoice) notFound();

  return (
    <div className="stack max-w-3xl">
      <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
        <div>
          <p className="text-xs font-semibold tracking-wider text-ink-muted uppercase">
            Platform admin
          </p>
          <h1 className="text-2xl font-bold tracking-tight text-ink">
            Invoice {invoice.invoiceNumber}
          </h1>
          <p className="text-sm text-ink-muted">
            <Link href={`/admin/businesses/${row.payment.businessId}`} className="text-accent">
              {row.businessName}
            </Link>
          </p>
        </div>
        <PrintButton />
      </div>
      <InvoiceDocument invoice={invoice} timezone={row.timezone} />
    </div>
  );
}

import { formatDate } from '@/lib/dashboard/presentation';
import type { InvoiceView } from '@/lib/billing/invoice-view';

/**
 * AMENDMENT-029 — a tax invoice, printed from the snapshots on the payment row. Shared by the
 * owner's receipt page and the admin's invoice page; a server component with no state, so
 * "download" is the browser's print-to-PDF and the printed copy is exactly this.
 *
 * When the seller was not GST-registered at the time of sale the document is titled a receipt
 * and shows the amount alone — an unregistered seller may not put GST on paper.
 */
export function InvoiceDocument({ invoice, timezone }: { invoice: InvoiceView; timezone: string }) {
  const { tax } = invoice;
  const title = tax.gst_applicable ? 'Tax invoice' : 'Receipt';
  const money = (paise: number) => invoiceMoney(paise, invoice.currency);
  const date = (d: Date | null) => formatDate(d, timezone) ?? '—';
  const refunded = invoice.refundedPaise > 0;

  return (
    <article
      className="rounded-card border border-border bg-surface p-6 text-sm text-ink print:border-0 print:p-0"
      aria-labelledby="invoice-title"
    >
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-4">
        <div>
          <p className="text-xs font-semibold tracking-wider text-ink-muted uppercase">
            {invoice.seller.legal_name}
          </p>
          <h2 id="invoice-title" className="text-xl font-bold tracking-tight">
            {title}
          </h2>
          {invoice.seller.address && (
            <p className="mt-1 whitespace-pre-line text-ink-muted">{invoice.seller.address}</p>
          )}
          {invoice.seller.gstin && (
            <p className="mt-1">
              <span className="text-ink-muted">GSTIN</span>{' '}
              <span className="font-mono">{invoice.seller.gstin}</span>
              {invoice.seller.state_code && (
                <span className="text-ink-muted"> · State {invoice.seller.state_code}</span>
              )}
            </p>
          )}
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-right">
          <dt className="text-ink-muted">Invoice no.</dt>
          <dd className="font-mono font-semibold">{invoice.invoiceNumber}</dd>
          <dt className="text-ink-muted">Date</dt>
          <dd>{date(invoice.issuedAt)}</dd>
          {tax.gst_applicable && (
            <>
              <dt className="text-ink-muted">Place of supply</dt>
              <dd>
                State {tax.place_of_supply_state_code}
                {tax.place_of_supply_basis === 'seller_state_default' && (
                  <span className="text-ink-muted"> (buyer state not given)</span>
                )}
              </dd>
            </>
          )}
        </dl>
      </header>

      <section className="grid gap-6 py-4 sm:grid-cols-2">
        <div>
          <h3 className="text-xs font-semibold tracking-wider text-ink-muted uppercase">
            Billed to
          </h3>
          <p className="mt-1 font-medium">{invoice.buyer.name}</p>
          {invoice.buyer.address && (
            <p className="whitespace-pre-line text-ink-muted">{invoice.buyer.address}</p>
          )}
          <p className="text-ink-muted">{invoice.buyer.email}</p>
          {invoice.buyer.gstin && (
            <p>
              <span className="text-ink-muted">GSTIN</span>{' '}
              <span className="font-mono">{invoice.buyer.gstin}</span>
              {invoice.buyer.state_code && (
                <span className="text-ink-muted"> · State {invoice.buyer.state_code}</span>
              )}
            </p>
          )}
        </div>
        <div>
          <h3 className="text-xs font-semibold tracking-wider text-ink-muted uppercase">Payment</h3>
          <p className="mt-1">
            Paid on {date(invoice.paidAt ?? invoice.issuedAt)} through Razorpay
          </p>
          {invoice.providerPaymentId && (
            <p className="font-mono text-xs text-ink-muted">{invoice.providerPaymentId}</p>
          )}
          {invoice.providerOrderId && (
            <p className="font-mono text-xs text-ink-muted">order {invoice.providerOrderId}</p>
          )}
        </div>
      </section>

      <table className="w-full border-collapse">
        <caption className="sr-only">Invoice lines</caption>
        <thead>
          <tr className="border-y border-border text-left text-xs tracking-wider text-ink-muted uppercase">
            <th scope="col" className="py-2 pr-2 font-semibold">
              Description
            </th>
            <th scope="col" className="py-2 px-2 font-semibold">
              SAC
            </th>
            <th scope="col" className="py-2 pl-2 text-right font-semibold">
              Amount
            </th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-border">
            <td className="py-3 pr-2">
              Ai Review Pro — one year
              {invoice.period.startsAt && invoice.period.expiresAt && (
                <span className="block text-ink-muted">
                  {date(invoice.period.startsAt)} to {date(invoice.period.expiresAt)}
                </span>
              )}
            </td>
            <td className="py-3 px-2 font-mono text-xs">{invoice.seller.sac_code}</td>
            <td className="py-3 pl-2 text-right tabular-nums">
              {money(tax.gst_applicable ? tax.taxable_paise : tax.gross_paise)}
            </td>
          </tr>
          {invoice.lines.slice(1).map((line) => (
            <tr key={line.label}>
              <td className="py-1 pr-2 text-ink-muted" colSpan={2}>
                {line.label}
              </td>
              <td className="py-1 pl-2 text-right tabular-nums">{money(line.amountPaise)}</td>
            </tr>
          ))}
          <tr className="border-t border-border">
            <td className="py-3 pr-2 font-semibold" colSpan={2}>
              Total paid{tax.gst_applicable ? ' (GST included)' : ''}
            </td>
            <td className="py-3 pl-2 text-right text-base font-semibold tabular-nums">
              {money(invoice.grossPaise)}
            </td>
          </tr>
          {refunded && (
            <tr>
              <td className="py-1 pr-2 text-ink-muted" colSpan={2}>
                Refunded
              </td>
              <td className="py-1 pl-2 text-right tabular-nums text-ink-muted">
                − {money(invoice.refundedPaise)}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <footer className="mt-4 text-xs text-ink-muted">
        {tax.gst_applicable ? (
          <p>
            Price inclusive of GST at{' '}
            {(tax.rate_bps / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}%. Supply of
            online information and database access services. This is a computer-generated invoice
            and needs no signature.
          </p>
        ) : (
          <p>
            No GST is charged on this receipt: the seller was not registered under GST at the time
            of sale. This is a computer-generated receipt and needs no signature.
          </p>
        )}
      </footer>
    </article>
  );
}

/** Invoice lines always carry two decimals — ₹76.20, never ₹76.2 — so a column of tax adds up. */
function invoiceMoney(paise: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(paise / 100);
  } catch {
    return `${currency} ${(paise / 100).toFixed(2)}`;
  }
}

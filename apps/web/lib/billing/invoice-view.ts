import type { Payment } from '@ai-review/db';
import type { BuyerSnapshot, SellerSnapshot, TaxBreakdown } from '@ai-review/core';

/**
 * AMENDMENT-029 — the invoice as a view model, read from the snapshots frozen on the payment
 * row. Nothing here looks at the live business or settings: an invoice must render the same
 * next year as it did the day it was issued, whatever changed in between.
 */
export interface InvoiceLine {
  label: string;
  amountPaise: number;
}

export interface InvoiceView {
  invoiceNumber: string;
  issuedAt: Date;
  paidAt: Date | null;
  currency: string;
  grossPaise: number;
  refundedPaise: number;
  status: Payment['status'];
  seller: SellerSnapshot;
  buyer: BuyerSnapshot;
  tax: TaxBreakdown;
  /** Taxable value then each tax component, in the order they print. */
  lines: InvoiceLine[];
  period: { startsAt: Date | null; expiresAt: Date | null };
  providerPaymentId: string | null;
  providerOrderId: string | null;
}

function isoDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Null when the payment carries no invoice — a receipt, not an invoice, is what it gets. */
export function invoiceViewFrom(payment: Payment): InvoiceView | null {
  if (!payment.invoiceNumber || !payment.invoiceIssuedAt) return null;
  const seller = payment.sellerSnapshot as SellerSnapshot | null;
  const buyer = payment.buyerSnapshot as BuyerSnapshot | null;
  const tax = payment.taxBreakdown as TaxBreakdown | null;
  if (!seller || !buyer || !tax) return null;

  const lines: InvoiceLine[] = [];
  if (tax.gst_applicable) {
    lines.push({ label: 'Taxable value', amountPaise: tax.taxable_paise });
    const rate = `${(tax.rate_bps / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}%`;
    if (tax.supply === 'INTRA_STATE') {
      const half = `${(tax.rate_bps / 200).toLocaleString('en-IN', { maximumFractionDigits: 2 })}%`;
      lines.push({ label: `CGST @ ${half}`, amountPaise: tax.cgst_paise });
      lines.push({ label: `SGST @ ${half}`, amountPaise: tax.sgst_paise });
    } else {
      lines.push({ label: `IGST @ ${rate}`, amountPaise: tax.igst_paise });
    }
  }

  const reference = payment.rawReference as Record<string, unknown>;
  return {
    invoiceNumber: payment.invoiceNumber,
    issuedAt: payment.invoiceIssuedAt,
    paidAt: payment.paidAt,
    currency: payment.currency,
    grossPaise: payment.amountPaise,
    refundedPaise: payment.refundedPaise,
    status: payment.status,
    seller,
    buyer,
    tax,
    lines,
    period: {
      startsAt: isoDate(reference['period_starts_at']),
      expiresAt: isoDate(reference['period_expires_at']),
    },
    providerPaymentId: payment.providerPaymentId,
    providerOrderId: payment.providerOrderId,
  };
}

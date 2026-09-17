import { sql } from 'drizzle-orm';
import { invoiceSequences } from '@ai-review/db';
import type { Executor } from '../db-executor';
import {
  computeGstBreakdown,
  formatInvoiceNumber,
  GSTIN,
  indianFinancialYear,
  invoiceSeries,
  STATE_CODE,
  type TaxBreakdown,
} from './gst';

/**
 * Invoice numbering and the snapshots an invoice is made of (AMENDMENT-029).
 *
 * Numbers are drawn inside the settle transaction: the sequence row is bumped with one
 * UPSERT, which takes a row lock, so two payments settling at once queue on it and come out
 * consecutive; and a settle that rolls back releases the lock without the bump having
 * committed, so a failed settlement leaves no gap. Tax law wants numbers consecutive and
 * unbroken within a series — that is why this is not a bigserial default on the column.
 */

export interface InvoiceSellerSettings {
  seller_legal_name: string;
  seller_address: string;
  seller_gstin: string | null;
  seller_state_code: string | null;
  seller_sac_code: string;
  invoice_prefix: string;
  gst_rate_bps: number;
}

export interface InvoiceBuyer {
  businessId: string;
  businessName: string;
  billingLegalName: string | null;
  gstin: string | null;
  stateCode: string | null;
  address: string | null;
  email: string;
}

export interface SellerSnapshot {
  legal_name: string;
  address: string;
  gstin: string | null;
  state_code: string | null;
  sac_code: string;
}

export interface BuyerSnapshot {
  business_id: string;
  name: string;
  gstin: string | null;
  state_code: string | null;
  address: string | null;
  email: string;
}

export interface InvoiceSnapshot {
  seller: SellerSnapshot;
  buyer: BuyerSnapshot;
  tax: TaxBreakdown;
}

/**
 * Draws the next number in the series for `at`'s financial year. Call inside the transaction
 * that writes the invoice; the number is only real once that transaction commits.
 */
export async function allocateInvoiceNumber(
  tx: Executor,
  input: { prefix: string; at: Date },
): Promise<string> {
  const series = invoiceSeries(input.prefix, indianFinancialYear(input.at));
  const [row] = await tx
    .insert(invoiceSequences)
    .values({ series, nextValue: 2 })
    .onConflictDoUpdate({
      target: invoiceSequences.series,
      set: { nextValue: sql`${invoiceSequences.nextValue} + 1` },
    })
    .returning({ nextValue: invoiceSequences.nextValue });
  return formatInvoiceNumber(series, row!.nextValue - 1);
}

/**
 * What goes on the invoice, frozen at the moment of sale. Later edits to the seller's details
 * or the buyer's billing profile never rewrite an issued invoice (ADMIN-04-02).
 *
 * GST is split out only when the seller holds a GSTIN and a state code; a seller who is not
 * registered may not charge it, so until an admin fills those in the invoice records the
 * gross amount with the reason no tax is shown.
 */
export function buildInvoiceSnapshot(input: {
  seller: InvoiceSellerSettings;
  buyer: InvoiceBuyer;
  grossPaise: number;
}): InvoiceSnapshot {
  const { seller, buyer } = input;
  const registered =
    seller.seller_gstin !== null &&
    GSTIN.test(seller.seller_gstin) &&
    seller.seller_state_code !== null &&
    STATE_CODE.test(seller.seller_state_code);
  const tax: TaxBreakdown = registered
    ? computeGstBreakdown({
        grossPaise: input.grossPaise,
        rateBps: seller.gst_rate_bps,
        sellerStateCode: seller.seller_state_code!,
        buyerStateCode: buyer.stateCode,
      })
    : { gst_applicable: false, gross_paise: input.grossPaise, reason: 'seller_not_registered' };
  return {
    seller: {
      legal_name: seller.seller_legal_name,
      address: seller.seller_address,
      gstin: registered ? seller.seller_gstin : null,
      state_code: registered ? seller.seller_state_code : null,
      sac_code: seller.seller_sac_code,
    },
    buyer: {
      business_id: buyer.businessId,
      name: buyer.billingLegalName?.trim() || buyer.businessName,
      gstin: buyer.gstin,
      state_code: buyer.stateCode,
      address: buyer.address,
      email: buyer.email,
    },
    tax,
  };
}

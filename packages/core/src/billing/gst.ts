/**
 * GST arithmetic for a tax-inclusive price (AMENDMENT-029).
 *
 * The platform price is quoted inclusive of GST (₹999, D-005), so the invoice works backwards
 * from the amount paid: taxable value = gross × 10000 ÷ (10000 + rate in basis points), tax =
 * gross − taxable. Everything is whole paise; rounding happens once, on the taxable value, so
 * taxable + tax always equals what was charged. Intra-state supply splits the tax into CGST and
 * SGST (the odd paisa goes to SGST); inter-state supply is IGST in full.
 *
 * Which of the two applies is the place of supply. For an online service that is the buyer's
 * state when known; when the buyer has not given one, the seller's own state is used and the
 * breakdown says so, so an accountant can see which invoices rest on that default.
 */

export interface GstInput {
  /** What the buyer paid, in paise, GST included. */
  grossPaise: number;
  /** GST rate in basis points (1800 = 18%). */
  rateBps: number;
  /** The seller's GST state code (two digits). */
  sellerStateCode: string;
  /** The buyer's state code, when they gave one. */
  buyerStateCode: string | null;
}

export interface GstBreakdown {
  gst_applicable: true;
  rate_bps: number;
  gross_paise: number;
  taxable_paise: number;
  tax_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  supply: 'INTRA_STATE' | 'INTER_STATE';
  place_of_supply_state_code: string;
  place_of_supply_basis: 'buyer_state' | 'seller_state_default';
}

export interface NoGstBreakdown {
  gst_applicable: false;
  gross_paise: number;
  /** Why no tax was split out — today only that the seller holds no GSTIN. */
  reason: 'seller_not_registered';
}

export type TaxBreakdown = GstBreakdown | NoGstBreakdown;

export const STATE_CODE = /^[0-9]{2}$/;
/** The GSTIN format: 2-digit state, 10-char PAN, entity digit, 'Z', check character. */
export const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export function computeGstBreakdown(input: GstInput): GstBreakdown {
  if (!Number.isInteger(input.grossPaise) || input.grossPaise < 0) {
    throw new RangeError('grossPaise must be a non-negative whole number of paise');
  }
  if (!Number.isInteger(input.rateBps) || input.rateBps < 0 || input.rateBps > 10_000) {
    throw new RangeError('rateBps must be a whole number from 0 to 10000');
  }
  if (!STATE_CODE.test(input.sellerStateCode)) {
    throw new RangeError('sellerStateCode must be two digits');
  }
  const buyerKnown = input.buyerStateCode !== null && STATE_CODE.test(input.buyerStateCode);
  const placeOfSupply = buyerKnown ? input.buyerStateCode! : input.sellerStateCode;
  const taxable = Math.round((input.grossPaise * 10_000) / (10_000 + input.rateBps));
  const tax = input.grossPaise - taxable;
  const intra = placeOfSupply === input.sellerStateCode;
  const cgst = intra ? Math.floor(tax / 2) : 0;
  return {
    gst_applicable: true,
    rate_bps: input.rateBps,
    gross_paise: input.grossPaise,
    taxable_paise: taxable,
    tax_paise: tax,
    cgst_paise: cgst,
    sgst_paise: intra ? tax - cgst : 0,
    igst_paise: intra ? 0 : tax,
    supply: intra ? 'INTRA_STATE' : 'INTER_STATE',
    place_of_supply_state_code: placeOfSupply,
    place_of_supply_basis: buyerKnown ? 'buyer_state' : 'seller_state_default',
  };
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/**
 * The Indian financial year an instant falls in, as "2026-27". April to March, judged in IST:
 * a payment at 23:30 UTC on 31 March is already 1 April in India and opens the new series.
 */
export function indianFinancialYear(at: Date): string {
  const ist = new Date(at.getTime() + IST_OFFSET_MS);
  const year = ist.getUTCFullYear();
  const startYear = ist.getUTCMonth() >= 3 ? year : year - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

/** The sequence a number is drawn from — one per prefix and financial year. */
export function invoiceSeries(prefix: string, financialYear: string): string {
  return `${prefix}/${financialYear}`;
}

/** `DH/2026-27/000001`. Six digits leaves room for a million invoices a year. */
export function formatInvoiceNumber(series: string, sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new RangeError('sequence must be a positive whole number');
  }
  return `${series}/${String(sequence).padStart(6, '0')}`;
}

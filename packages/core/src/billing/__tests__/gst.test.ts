import { describe, expect, it } from 'vitest';
import {
  computeGstBreakdown,
  formatInvoiceNumber,
  GSTIN,
  indianFinancialYear,
  invoiceSeries,
} from '../gst';
import { buildInvoiceSnapshot } from '../invoice-service';

describe('computeGstBreakdown', () => {
  it('works ₹999 inclusive back to the spec numbers, split CGST/SGST within the state', () => {
    const b = computeGstBreakdown({
      grossPaise: 99_900,
      rateBps: 1800,
      sellerStateCode: '29',
      buyerStateCode: '29',
    });
    expect(b).toMatchObject({
      taxable_paise: 84_661,
      tax_paise: 15_239,
      cgst_paise: 7_619,
      sgst_paise: 7_620,
      igst_paise: 0,
      supply: 'INTRA_STATE',
      place_of_supply_basis: 'buyer_state',
    });
    expect(b.taxable_paise + b.tax_paise).toBe(99_900);
    expect(b.cgst_paise + b.sgst_paise + b.igst_paise).toBe(b.tax_paise);
  });

  it('charges IGST across states, and defaults the place of supply to the seller', () => {
    const inter = computeGstBreakdown({
      grossPaise: 99_900,
      rateBps: 1800,
      sellerStateCode: '29',
      buyerStateCode: '27',
    });
    expect(inter).toMatchObject({ igst_paise: 15_239, cgst_paise: 0, supply: 'INTER_STATE' });

    const unknown = computeGstBreakdown({
      grossPaise: 99_900,
      rateBps: 1800,
      sellerStateCode: '29',
      buyerStateCode: null,
    });
    expect(unknown).toMatchObject({
      supply: 'INTRA_STATE',
      place_of_supply_state_code: '29',
      place_of_supply_basis: 'seller_state_default',
    });
  });

  it('always sums back to the gross, whatever the amount', () => {
    for (const gross of [1, 99, 100, 101, 12_345, 99_900, 10_000_000]) {
      const b = computeGstBreakdown({
        grossPaise: gross,
        rateBps: 1800,
        sellerStateCode: '07',
        buyerStateCode: '07',
      });
      expect(b.taxable_paise + b.tax_paise).toBe(gross);
      expect(b.cgst_paise + b.sgst_paise).toBe(b.tax_paise);
    }
  });

  it('refuses nonsense', () => {
    expect(() =>
      computeGstBreakdown({
        grossPaise: 1.5,
        rateBps: 1800,
        sellerStateCode: '29',
        buyerStateCode: null,
      }),
    ).toThrow(RangeError);
    expect(() =>
      computeGstBreakdown({
        grossPaise: 100,
        rateBps: 20_000,
        sellerStateCode: '29',
        buyerStateCode: null,
      }),
    ).toThrow(RangeError);
    expect(() =>
      computeGstBreakdown({
        grossPaise: 100,
        rateBps: 1800,
        sellerStateCode: 'KA',
        buyerStateCode: null,
      }),
    ).toThrow(RangeError);
  });
});

describe('indianFinancialYear', () => {
  it('turns over on 1 April, Indian time', () => {
    expect(indianFinancialYear(new Date('2026-09-16T10:00:00Z'))).toBe('2026-27');
    expect(indianFinancialYear(new Date('2027-03-31T18:29:59Z'))).toBe('2026-27');
    // 18:30 UTC on 31 March is 00:00 IST on 1 April.
    expect(indianFinancialYear(new Date('2027-03-31T18:30:00Z'))).toBe('2027-28');
    expect(indianFinancialYear(new Date('2027-01-15T00:00:00Z'))).toBe('2026-27');
    expect(indianFinancialYear(new Date('2099-04-01T00:00:00Z'))).toBe('2099-00');
  });
});

describe('invoice numbers', () => {
  it('formats prefix / year / six digits', () => {
    const series = invoiceSeries('DH', '2026-27');
    expect(series).toBe('DH/2026-27');
    expect(formatInvoiceNumber(series, 1)).toBe('DH/2026-27/000001');
    expect(formatInvoiceNumber(series, 123_456)).toBe('DH/2026-27/123456');
    expect(() => formatInvoiceNumber(series, 0)).toThrow(RangeError);
  });

  it('keeps the series key inside the column', () => {
    expect(invoiceSeries('ABCDEFGH', '2026-27').length).toBeLessThanOrEqual(20);
  });
});

describe('GSTIN format', () => {
  it('accepts a well-formed number and refuses a malformed one', () => {
    expect(GSTIN.test('29ABCDE1234F1Z5')).toBe(true);
    expect(GSTIN.test('29abcde1234f1z5')).toBe(false);
    expect(GSTIN.test('29ABCDE1234F1Y5')).toBe(false);
    expect(GSTIN.test('29ABCDE1234F1Z')).toBe(false);
  });
});

describe('buildInvoiceSnapshot', () => {
  const seller = {
    seller_legal_name: 'Digital Hammerr',
    seller_address: '1 Main Road',
    seller_gstin: '29ABCDE1234F1Z5',
    seller_state_code: '29',
    seller_sac_code: '998314',
    invoice_prefix: 'DH',
    gst_rate_bps: 1800,
  };
  const buyer = {
    businessId: 'b1',
    businessName: 'South Cafe',
    billingLegalName: null,
    gstin: null,
    stateCode: null,
    address: null,
    email: 'owner@example.com',
  };

  it('splits GST when the seller is registered, and names the buyer by its legal name', () => {
    const snap = buildInvoiceSnapshot({
      seller,
      buyer: { ...buyer, billingLegalName: ' South Cafe Pvt Ltd ', stateCode: '27' },
      grossPaise: 99_900,
    });
    expect(snap.tax).toMatchObject({ gst_applicable: true, igst_paise: 15_239 });
    expect(snap.buyer.name).toBe('South Cafe Pvt Ltd');
    expect(snap.seller).toEqual({
      legal_name: 'Digital Hammerr',
      address: '1 Main Road',
      gstin: '29ABCDE1234F1Z5',
      state_code: '29',
      sac_code: '998314',
    });
  });

  it('records the gross only, with the reason, when the seller holds no GSTIN', () => {
    const snap = buildInvoiceSnapshot({
      seller: { ...seller, seller_gstin: null },
      buyer,
      grossPaise: 99_900,
    });
    expect(snap.tax).toEqual({
      gst_applicable: false,
      gross_paise: 99_900,
      reason: 'seller_not_registered',
    });
    expect(snap.seller.gstin).toBeNull();
    expect(snap.buyer.name).toBe('South Cafe');
  });
});

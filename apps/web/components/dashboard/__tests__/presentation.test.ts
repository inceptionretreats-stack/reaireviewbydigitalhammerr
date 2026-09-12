import { describe, expect, it } from 'vitest';
import {
  describeBusinessStatus,
  describePlan,
  describeQrSources,
  foldQrSources,
  formatDate,
  formatMoney,
} from '../presentation';

/**
 * The dashboard's pure logic. Three things here are worth pinning rather than reviewing.
 *
 * `formatDate` is the AC-026 one: the date must be the one in `businesses.timezone`, which for this
 * product defaults to Asia/Kolkata (AMENDMENT-004). A late-evening UTC instant is already the next
 * day in India, so the assertions below fail against any implementation that formats in UTC or in
 * whatever zone the Node process happens to be running in.
 *
 * `formatMoney` and `formatDate` both carry a catch-fallback for a column value Intl refuses, and a
 * fallback nothing exercises is a 500 waiting for the first tenant with a bad row.
 *
 * `describeQrSources` is a set of sentences an owner acts on — one decides whether a standee stays
 * on the counter — so each branch has to be true of the state that produced it.
 */

/** 2026-08-31T19:00Z is 2026-09-01T00:30 in Asia/Kolkata (UTC+05:30). */
const EVENING_IN_INDIA = new Date('2026-08-31T19:00:00Z');

describe('formatDate', () => {
  it('reports the business-local day, not the UTC one (AC-026, AMENDMENT-004)', () => {
    expect(formatDate(EVENING_IN_INDIA, 'Asia/Kolkata')).toContain('1 Sep');
    expect(formatDate(EVENING_IN_INDIA, 'UTC')).toContain('31 Aug');
  });

  it('depends on the passed timezone alone, whatever zone the process runs in', () => {
    // The same instant, three configured zones, three answers — nothing here reads the ambient
    // timezone, so a server moved between regions cannot shift a tenant's dates.
    expect(formatDate(EVENING_IN_INDIA, 'Asia/Kolkata')).not.toBe(
      formatDate(EVENING_IN_INDIA, 'America/New_York'),
    );
    expect(formatDate(EVENING_IN_INDIA, 'America/New_York')).toBe(
      formatDate(EVENING_IN_INDIA, 'UTC'),
    );
  });

  it('falls back to UTC for an unrecognised zone rather than throwing', () => {
    // businesses.timezone is free text, and this runs inside a Server Component: an exception here
    // takes the whole dashboard down over a formatting detail.
    expect(formatDate(EVENING_IN_INDIA, 'Mars/Phobos')).toBe(formatDate(EVENING_IN_INDIA, 'UTC'));
    expect(formatDate(EVENING_IN_INDIA, '')).toBe(formatDate(EVENING_IN_INDIA, 'UTC'));
  });

  it('has nothing to say about a null date', () => {
    expect(formatDate(null, 'Asia/Kolkata')).toBeNull();
  });
});

describe('formatMoney', () => {
  it('prints the one V1 price as a round rupee amount (D-005)', () => {
    expect(formatMoney(99900, 'INR')).toBe('₹999');
  });

  it('keeps paise when a price actually has them', () => {
    expect(formatMoney(99950, 'INR')).toBe('₹999.5');
    expect(formatMoney(0, 'INR')).toBe('₹0');
  });

  it('falls back to the bare code for a currency Intl refuses', () => {
    // currency is a plain char(3), so a value that is not a currency code is reachable.
    expect(formatMoney(99900, '12A')).toBe('12A 999.00');
    expect(formatMoney(99900, '   ')).toBe('    999.00');
  });
});

describe('foldQrSources', () => {
  it('splits the grouped rows into enabled and disabled', () => {
    expect(
      foldQrSources([
        { status: 'ACTIVE', rows: 3 },
        { status: 'DISABLED', rows: 2 },
      ]),
    ).toEqual({ active: 3, disabled: 2, total: 5 });
  });

  it('reports zeros for a tenant with no sources, since no row comes back at all', () => {
    expect(foldQrSources([])).toEqual({ active: 0, disabled: 0, total: 0 });
  });

  it('counts an all-disabled tenant as none enabled rather than as none at all', () => {
    expect(foldQrSources([{ status: 'DISABLED', rows: 2 }])).toEqual({
      active: 0,
      disabled: 2,
      total: 2,
    });
  });
});

describe('describeQrSources', () => {
  it('points a draft tenant at publishing, which is what creates the first code', () => {
    expect(describeQrSources({ active: 0, disabled: 0, total: 0 }, 'DRAFT')).toBe(
      'Your first QR code is created when you publish.',
    );
  });

  it('never tells a suspended or closed tenant that its sources are working', () => {
    // The regression this exists for: lib/public-business.ts resolves a QR only for an ACTIVE
    // business, so "Every source you have created is working." was false for these two states.
    for (const status of ['SUSPENDED', 'CLOSED'] as const) {
      const hint = describeQrSources({ active: 2, disabled: 0, total: 2 }, status);
      expect(hint).toBe('No source is scanning while your public page is unavailable.');
      expect(hint).not.toContain('working');
    }
  });

  it('says nothing scans when every source is disabled, and never says "more"', () => {
    // "2 more are disabled." above a value of 0 reads as two of some larger number being off.
    expect(describeQrSources({ active: 0, disabled: 2, total: 2 }, 'ACTIVE')).toBe(
      'All 2 of your sources are disabled, so nothing scans.',
    );
    expect(describeQrSources({ active: 0, disabled: 1, total: 1 }, 'ACTIVE')).toBe(
      'Your only source is disabled, so nothing scans.',
    );
    expect(describeQrSources({ active: 0, disabled: 3, total: 3 }, 'ACTIVE')).not.toContain('more');
  });

  it('counts the disabled remainder for a live tenant that has both', () => {
    expect(describeQrSources({ active: 4, disabled: 1, total: 5 }, 'ACTIVE')).toBe(
      '1 more is disabled.',
    );
    expect(describeQrSources({ active: 4, disabled: 2, total: 6 }, 'ACTIVE')).toBe(
      '2 more are disabled.',
    );
    expect(describeQrSources({ active: 4, disabled: 0, total: 4 }, 'ACTIVE')).toBe(
      'Every source you have created is working.',
    );
  });
});

describe('describeBusinessStatus', () => {
  it('treats only ACTIVE as publicly live, the way lib/public-business.ts does', () => {
    expect(describeBusinessStatus('ACTIVE').isPubliclyLive).toBe(true);
    for (const status of ['DRAFT', 'SUSPENDED', 'CLOSED'] as const) {
      expect(describeBusinessStatus(status).isPubliclyLive).toBe(false);
    }
  });

  it('tells a suspended owner where to go, rather than leaving a silent dead page', () => {
    expect(describeBusinessStatus('SUSPENDED').note).toContain('Contact support');
    expect(describeBusinessStatus('SUSPENDED').badge).toBe('DISABLED');
  });
});

describe('describePlan', () => {
  it('selects the independent lifetime or annual quota for each plan state', () => {
    // Free usage remains intact across an upgrade; paid states show the separate annual counter.
    expect(describePlan('FREE').quotaKind).toBe('FREE');
    expect(describePlan('CHECKOUT_PENDING').quotaKind).toBe('FREE');
    expect(describePlan('EXPIRED').quotaKind).toBe('FREE');
    expect(describePlan('CANCELLED').quotaKind).toBe('FREE');
    expect(describePlan('PRO_ACTIVE').quotaKind).toBe('PRO');
    expect(describePlan('PAST_DUE').quotaKind).toBe('PRO');
  });
});

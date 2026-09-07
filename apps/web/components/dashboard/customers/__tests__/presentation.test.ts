import { describe, expect, it } from 'vitest';
import {
  CUSTOMER_STATUS_ORDER,
  OWNER_SETTABLE_STATUSES,
  isObservedStatus,
} from '../../../../app/api/v1/customers/customer-status';
import {
  OWNER_STATUS_OPTIONS,
  STATUS_LEGEND,
  describeStatus,
  describeStatusAuthority,
  formatMobile,
  formatVisitDate,
} from '../presentation';

/**
 * The review-policy guard on this screen's own words.
 *
 * `eslint.config.mjs` already fails the build on "review submitted", which catches the one phrase
 * somebody is most likely to type. This is the wider version of the same rule for the status
 * vocabulary specifically: the platform may only ever report that Google was *opened* (D-028, AC-025,
 * rule 8 of `13_Security_Privacy_Compliance.md`), so no label or explanation here may imply that a
 * review was written, posted, verified or counted.
 */
const CLAIMS_MORE_THAN_OPENING =
  /\b(submit|submitted|submitting|posted|published|verified|approved|left a review)\b/i;

describe('status vocabulary', () => {
  it('never claims more than that Google was opened', () => {
    for (const { presentation } of STATUS_LEGEND) {
      expect(presentation.label).not.toMatch(CLAIMS_MORE_THAN_OPENING);
      expect(presentation.detail).not.toMatch(CLAIMS_MORE_THAN_OPENING);
    }
  });

  it('says of GOOGLE_OPENED only that the page was opened', () => {
    const presentation = describeStatus('GOOGLE_OPENED');
    expect(presentation.label.toLowerCase()).toContain('opened');
    // The whole point: what happens on Google's own page is not observable from here.
    expect(presentation.detail.toLowerCase()).toContain('cannot see');
  });

  it('says that a manually sent message was sent by the owner, not by the platform', () => {
    // REQ-01-03 and D-017: the platform never sends anything, so this status is the owner's own word.
    const presentation = describeStatus('MESSAGE_SENT_MANUAL');
    expect(presentation.detail.toLowerCase()).toContain('yourself');
    expect(presentation.detail.toLowerCase()).toContain('never send');
  });

  it('labels and explains every status the database can hold', () => {
    const labels = new Set<string>();
    for (const status of CUSTOMER_STATUS_ORDER) {
      const presentation = describeStatus(status);
      expect(presentation.label).not.toBe('');
      expect(presentation.detail).not.toBe('');
      labels.add(presentation.label);
    }
    // Two statuses sharing a label would make the badge column meaningless.
    expect(labels.size).toBe(CUSTOMER_STATUS_ORDER.length);
  });

  it('tells the owner which statuses are theirs to change', () => {
    for (const status of CUSTOMER_STATUS_ORDER) {
      const sentence = describeStatusAuthority(status);
      expect(sentence).not.toBe('');
      if (isObservedStatus(status)) {
        expect(sentence.toLowerCase()).toContain('cannot be changed');
      }
    }
  });

  it('offers exactly the statuses the endpoint will accept', () => {
    // Derived from the same tuple the API validates against, so the dropdown cannot offer a value
    // that would come back as a 422 — or hide one that would be accepted.
    expect(OWNER_STATUS_OPTIONS.map((option) => option.value)).toEqual([
      ...OWNER_SETTABLE_STATUSES,
    ]);
  });
});

describe('visit date', () => {
  it('reads a stored calendar date without inventing a timezone', () => {
    expect(formatVisitDate('2026-09-07')).toBe('7 Sep 2026');
    expect(formatVisitDate('2026-01-31')).toBe('31 Jan 2026');
    expect(formatVisitDate('2026-12-01')).toBe('1 Dec 2026');
  });

  it('shows nothing rather than a guess for a missing or unusable value', () => {
    expect(formatVisitDate(null)).toBeNull();
    expect(formatVisitDate('')).toBeNull();
    expect(formatVisitDate('07/09/2026')).toBeNull();
    // A month the column could not hold, but which the string form could carry.
    expect(formatVisitDate('2026-13-01')).toBeNull();
  });
});

describe('mobile number display (CRM-01-03)', () => {
  it('groups a stored Indian number for reading', () => {
    expect(formatMobile('+919876543210')).toBe('+91 98765 43210');
  });

  it('leaves any other country exactly as stored', () => {
    // `normalizePhone` shape-validates Indian numbers only, so there is no national format to assume.
    expect(formatMobile('+14155552671')).toBe('+14155552671');
    expect(formatMobile('+442071838750')).toBe('+442071838750');
  });
});

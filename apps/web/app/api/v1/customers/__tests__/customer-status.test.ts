import { describe, expect, it } from 'vitest';
import { customerRequestStatus } from '@ai-review/db/schema';
import {
  CUSTOMER_STATUS_ORDER,
  OWNER_SETTABLE_STATUSES,
  isCustomerStatus,
  isObservedStatus,
  isOwnerSettableStatusValue,
  statusAuthority,
} from '../customer-status';

/**
 * The one product rule in CRM-01 that a bug would make dishonest rather than merely broken.
 *
 * `customer_request_status` mixes two kinds of value: what the owner did, and what the platform saw
 * the customer do. Only the first kind may ever arrive in a request body. If GOOGLE_OPENED became
 * settable, the product would be reporting a Google visit that nobody observed — which is exactly
 * what D-028, AC-025 and rule 8 of `13_Security_Privacy_Compliance.md` are written to prevent.
 */
describe('who may write a customer status', () => {
  it('lets the owner record only their own actions', () => {
    expect([...OWNER_SETTABLE_STATUSES]).toEqual(['NOT_CONTACTED', 'MESSAGE_SENT_MANUAL']);
  });

  it('never accepts an observed status from a request body', () => {
    for (const observed of [
      'LINK_CLICKED',
      'AI_GENERATED',
      'REVIEW_COPIED',
      'GOOGLE_OPENED',
      'PRIVATE_FEEDBACK',
    ] as const) {
      expect(isObservedStatus(observed)).toBe(true);
      expect(isOwnerSettableStatusValue(observed)).toBe(false);
    }
  });

  it('locks the status once the platform has observed the customer', () => {
    // The five above are history; the three below are still the owner's own record, so an edit
    // that touches the status is allowed while a row sits on one of them.
    expect(isObservedStatus('NOT_CONTACTED')).toBe(false);
    expect(isObservedStatus('MESSAGE_PREPARED')).toBe(false);
    expect(isObservedStatus('MESSAGE_SENT_MANUAL')).toBe(false);
  });

  it('keeps MESSAGE_PREPARED out of the dropdown without treating it as history', () => {
    // REQ-01 writes it by preparing a message. Relabelling a row is not preparing one, so it is not
    // offered — but it is not an observation either, so it does not freeze the field.
    expect(statusAuthority('MESSAGE_PREPARED')).toBe('OWNER_ACTION');
    expect(statusAuthority('MESSAGE_PREPARED')).not.toBe('OWNER_SETTABLE');
    expect(isObservedStatus('MESSAGE_PREPARED')).toBe(false);
  });

  it('agrees with itself about which statuses the tuple contains', () => {
    // The tuple is hand-written so it can be a Zod-style literal union; this is what stops it
    // drifting away from the authority table it is supposed to mirror.
    for (const status of OWNER_SETTABLE_STATUSES) {
      expect(statusAuthority(status)).toBe('OWNER_SETTABLE');
    }
    for (const status of CUSTOMER_STATUS_ORDER) {
      expect(statusAuthority(status) === 'OWNER_SETTABLE').toBe(
        (OWNER_SETTABLE_STATUSES as readonly string[]).includes(status),
      );
    }
  });
});

describe('the status model covers the database enum', () => {
  it('classifies every value of customer_request_status, in order', () => {
    // Read from the schema rather than restated, so adding a ninth value to the enum fails here
    // instead of shipping a status that renders as an unlabelled badge and is neither
    // owner-settable nor observed.
    expect([...CUSTOMER_STATUS_ORDER]).toEqual([...customerRequestStatus.enumValues]);
  });

  it('recognises exactly those values at runtime', () => {
    for (const value of customerRequestStatus.enumValues) {
      expect(isCustomerStatus(value)).toBe(true);
    }
    for (const value of ['', 'toString', 'NOT_CONTACTED ', 'not_contacted', 42, null]) {
      expect(isCustomerStatus(value)).toBe(false);
    }
  });
});

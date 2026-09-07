import type { Customer } from '@ai-review/db';

/**
 * `customers.status` as a ladder, so the three rungs this module owns can only ever be climbed.
 *
 * CRM-01 calls the column "Manual status" and REQ-01 is the only screen that can set three of its
 * values: MESSAGE_PREPARED (Flow F step 5), MESSAGE_SENT_MANUAL (step 8) and LINK_CLICKED (step
 * 9). The remaining public-flow values are set by the customer's own journey.
 *
 * Modelling it as an ordered list rather than a plain assignment is what stops the column going
 * backwards. Preparing a second message for a customer who already opened the link would otherwise
 * reset them to "message prepared", and CRM-01's status filter would then report the *most recent
 * action* while claiming to describe how far the customer got. The column records the furthest
 * point reached.
 *
 * Type-only import from `@ai-review/db`, so the enum stays the single source of truth. `LADDER_RUNGS`
 * below is what makes that claim true: `satisfies readonly CustomerJourneyStatus[]` on the ladder only
 * asserts that every value listed is a member of the enum, so adding a value to
 * `customerRequestStatus` would compile cleanly here and the new value would silently become
 * unrankable — `statusesBelow` could never return it, so no advance could ever overwrite it, which is
 * a live behaviour change nobody would be told about.
 */

export type CustomerJourneyStatus = Customer['status'];

/**
 * PRIVATE_FEEDBACK is deliberately absent.
 *
 * It is a branch of the flow, not a rung on it: a customer who wrote privately (D-010) did
 * something different from one who opened Google, and it is not "further" or "less far" than
 * anything else. Leaving it off the ladder means a later click never overwrites it, which is the
 * conservative choice — a business must not lose the signal that someone contacted them directly.
 */
export const JOURNEY_LADDER = [
  'NOT_CONTACTED',
  'MESSAGE_PREPARED',
  'MESSAGE_SENT_MANUAL',
  'LINK_CLICKED',
  'AI_GENERATED',
  'REVIEW_COPIED',
  'GOOGLE_OPENED',
] as const satisfies readonly CustomerJourneyStatus[];

export type LadderStatus = (typeof JOURNEY_LADDER)[number];

/**
 * Every value of `customer_request_status`, classified: on the ladder, or a branch off it.
 *
 * This is the exhaustiveness check the header promises. `Record<CustomerJourneyStatus, boolean>`
 * requires a key per enum member, so adding a value to `packages/db/src/schema/enums.ts` is a
 * missing-property error here — the maintainer is asked which it is instead of getting a status that
 * silently cannot be ranked. `__tests__/customer-journey.test.ts` pins the same agreement at runtime,
 * against the enum's own `enumValues`, so the guarantee survives a stray type assertion too.
 */
const LADDER_RUNGS: Record<CustomerJourneyStatus, boolean> = {
  NOT_CONTACTED: true,
  MESSAGE_PREPARED: true,
  MESSAGE_SENT_MANUAL: true,
  LINK_CLICKED: true,
  AI_GENERATED: true,
  REVIEW_COPIED: true,
  GOOGLE_OPENED: true,
  // A branch of the flow, not a rung on it — see above (D-010).
  PRIVATE_FEEDBACK: false,
};

/** Whether a status can be a target of `advanceCustomerStatus`, i.e. whether it is a rung. */
export function isLadderStatus(status: CustomerJourneyStatus): status is LadderStatus {
  return LADDER_RUNGS[status];
}

/**
 * The statuses an update to `target` may overwrite: strictly the rungs below it.
 *
 * Returned as the list for a SQL `IN`, so the advance is one atomic conditional UPDATE with no
 * read-modify-write — the same shape OPEN-01 requires of quota consumption, for the same reason.
 * Two concurrent clicks on one tracked link cannot interleave into a lost update, and a customer
 * already at GOOGLE_OPENED is simply not matched by the WHERE clause.
 */
export function statusesBelow(target: LadderStatus): LadderStatus[] {
  const index = JOURNEY_LADDER.indexOf(target);
  return JOURNEY_LADDER.slice(0, index);
}

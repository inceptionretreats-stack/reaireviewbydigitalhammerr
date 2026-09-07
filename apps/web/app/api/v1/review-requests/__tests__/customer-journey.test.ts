import { describe, expect, it } from 'vitest';
import { customerRequestStatus } from '@ai-review/db/schema';
import {
  JOURNEY_LADDER,
  isLadderStatus,
  statusesBelow,
  type CustomerJourneyStatus,
} from '../customer-journey';

/**
 * The status ladder that keeps `customers.status` from going backwards.
 *
 * These are the assertions that make the ladder worth having: the set returned here becomes a SQL
 * `IN`, so anything wrongly included is a status the next action would silently overwrite.
 */
describe('statusesBelow', () => {
  it('lets a prepared message overwrite only an uncontacted customer', () => {
    expect(statusesBelow('MESSAGE_PREPARED')).toEqual(['NOT_CONTACTED']);
  });

  it('lets a click overwrite the two states that precede it, and nothing else', () => {
    expect(statusesBelow('LINK_CLICKED')).toEqual([
      'NOT_CONTACTED',
      'MESSAGE_PREPARED',
      'MESSAGE_SENT_MANUAL',
    ]);
  });

  it('never overwrites a status further along the journey', () => {
    // Preparing a second message for a customer who already reached Google must not reset them, or
    // CRM-01's status would report the owner's most recent action while claiming to describe the
    // customer's progress.
    for (const target of ['MESSAGE_PREPARED', 'MESSAGE_SENT_MANUAL', 'LINK_CLICKED'] as const) {
      expect(statusesBelow(target)).not.toContain('GOOGLE_OPENED');
      expect(statusesBelow(target)).not.toContain('REVIEW_COPIED');
      expect(statusesBelow(target)).not.toContain('AI_GENERATED');
    }
  });

  it('never overwrites PRIVATE_FEEDBACK', () => {
    // D-010: someone who wrote to the business privately did something different, not something
    // "less far along". A later click must not erase that signal.
    for (const target of ['MESSAGE_PREPARED', 'MESSAGE_SENT_MANUAL', 'LINK_CLICKED'] as const) {
      expect(statusesBelow(target)).not.toContain('PRIVATE_FEEDBACK');
    }
  });

  it('never includes the target itself, so a repeat action is a no-op rather than a rewrite', () => {
    expect(statusesBelow('MESSAGE_SENT_MANUAL')).not.toContain('MESSAGE_SENT_MANUAL');
  });

  it('returns nothing for the first rung, so the caller can skip the query', () => {
    expect(statusesBelow('NOT_CONTACTED')).toEqual([]);
  });
});

/**
 * The ladder against the enum it claims to cover.
 *
 * The module header says adding a value to `customer_request_status` is a compile error here rather
 * than "a silently unrankable status". That was not true: `satisfies readonly CustomerJourneyStatus[]`
 * only asserts that the listed values are members of the enum, so a new member compiled cleanly and
 * became a status `statusesBelow` could never return — meaning no advance could ever overwrite it, a
 * live behaviour change nobody would have been told about. `LADDER_RUNGS` makes it a type error now;
 * this pins the same agreement at runtime, against the enum's own values, so a type assertion cannot
 * quietly get past it either.
 */
describe('the ladder covers customer_request_status exhaustively', () => {
  const enumValues: readonly CustomerJourneyStatus[] = customerRequestStatus.enumValues;

  it('classifies every enum value as either a rung or a deliberate branch', () => {
    const rungs = enumValues.filter((status) => isLadderStatus(status));
    const branches = enumValues.filter((status) => !isLadderStatus(status));

    // Fails the moment a value is added to the enum without being placed on one side or the other.
    expect([...rungs].sort()).toEqual([...JOURNEY_LADDER].sort());
    // PRIVATE_FEEDBACK is the only branch, and it is one on purpose (D-010).
    expect(branches).toEqual(['PRIVATE_FEEDBACK']);
  });

  it('orders the ladder as the customer journey actually runs', () => {
    // Order is the whole mechanism: `statusesBelow` slices it, so a value in the wrong position makes
    // a status overwritable that should not be.
    expect(JOURNEY_LADDER).toEqual([
      'NOT_CONTACTED',
      'MESSAGE_PREPARED',
      'MESSAGE_SENT_MANUAL',
      'LINK_CLICKED',
      'AI_GENERATED',
      'REVIEW_COPIED',
      'GOOGLE_OPENED',
    ]);
  });

  it('never reports a branch as a valid advance target', () => {
    expect(isLadderStatus('PRIVATE_FEEDBACK')).toBe(false);
    expect(isLadderStatus('LINK_CLICKED')).toBe(true);
  });
});

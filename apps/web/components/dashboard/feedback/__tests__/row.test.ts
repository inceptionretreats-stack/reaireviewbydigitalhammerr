import { describe, expect, it } from 'vitest';
import {
  emptyFeedbackCounts,
  inboxBody,
  isFeedbackStatus,
  messagePreview,
  publicFormState,
  readFeedbackPage,
  shiftCounts,
  toFeedbackRow,
  type FeedbackWireItem,
} from '../row';

/**
 * The wire boundary and the view model behind FB-02's list.
 *
 * `readFeedbackPage` is the point where an unknown response becomes typed rows, so the negative
 * cases matter more than the positive one: without them a rolling deploy that changes the payload
 * shows the merchant a table of blanks instead of an honest "reload this page".
 */

const ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

function wireItem(overrides: Partial<FeedbackWireItem> = {}): FeedbackWireItem {
  return {
    id: ID,
    message: 'The dosa was excellent and the staff were kind.',
    name: 'Asha',
    mobile: '+919876543210',
    status: 'NEW',
    created_at: '2026-09-07T10:00:00.000Z',
    cursor: `2026-09-07T10:00:00.000000Z~${ID}`,
    ...overrides,
  };
}

describe('toFeedbackRow', () => {
  it('renders the timestamp in the business timezone, not UTC', () => {
    const row = toFeedbackRow(wireItem(), 'Asia/Kolkata');
    // 10:00 UTC is 15:30 in IST. The hour is what proves the zone was applied at all.
    expect(row.receivedLabel).toContain('3:30');
    expect(toFeedbackRow(wireItem(), 'UTC').receivedLabel).not.toBe(row.receivedLabel);
  });

  it('keeps a machine-readable instant alongside the human label', () => {
    expect(toFeedbackRow(wireItem(), 'Asia/Kolkata').receivedIso).toBe('2026-09-07T10:00:00.000Z');
  });

  it('carries the contact details through untouched', () => {
    const row = toFeedbackRow(wireItem({ name: 'Asha', mobile: '9876543210' }), 'UTC');
    expect(row.name).toBe('Asha');
    expect(row.mobile).toBe('9876543210');
  });

  /**
   * The first page is mapped in the server component and handed to the client one as `initialRows`,
   * which is what stops `Intl.DateTimeFormat` running again during hydration against the browser's
   * ICU data. That only works while a row is plain serializable data: put a `Date` on it and the RSC
   * payload would hand the browser a string, so the two renders would disagree again — or, for a
   * function, throw at the boundary.
   */
  it('is plain serializable data, so the server can format the label and ship it', () => {
    const row = toFeedbackRow(wireItem(), 'Asia/Kolkata');

    expect(JSON.parse(JSON.stringify(row))).toEqual(row);
    for (const value of Object.values(row)) {
      expect(value === null || typeof value === 'string').toBe(true);
    }
  });
});

/**
 * FB-02's never-received empty state may only offer the live form when the form actually serves.
 *
 * ONB-01 claims the slug at the identity save, long before publish, so "a slug exists" is not
 * "the page is live" — and `/{slug}/feedback` answers with the Flow J unavailable page for every
 * status but ACTIVE.
 */
describe('publicFormState', () => {
  const url = 'https://app.example.com/chai-corner/feedback';

  it('offers the live form to a published business', () => {
    expect(publicFormState('ACTIVE', url)).toEqual({ kind: 'live', url });
  });

  it('does not send a DRAFT business to its own unavailable page', () => {
    expect(publicFormState('DRAFT', url)).toEqual({ kind: 'draft' });
  });

  /** "Publish your page" would be false here, so this state says nothing about the cause. */
  it.each(['SUSPENDED', 'CLOSED'])('offers no link and no cause for %s', (lifecycle) => {
    expect(publicFormState(lifecycle, url)).toEqual({ kind: 'not-serving' });
  });

  it('needs an address as well as an ACTIVE status', () => {
    expect(publicFormState('ACTIVE', null)).toEqual({ kind: 'not-serving' });
  });

  /** TenantGuard reports `status` as a bare string, so the lookup has to be total. */
  it('falls back to claiming nothing for a status outside the enum', () => {
    expect(publicFormState('PENDING_REVIEW', url)).toEqual({ kind: 'not-serving' });
  });
});

describe('inboxBody', () => {
  const base = { rowCount: 25, nextCursor: null, hasDateFilter: false, total: 25 };

  it('shows the list whenever there are rows', () => {
    expect(inboxBody(base)).toEqual({ kind: 'list', pageEmptied: false });
  });

  /**
   * Archiving all 25 rows of a full page leaves `rows` empty while the cursor still points at page
   * two. Without this the table renders its column headers over a single blank cell.
   */
  it('keeps the list, with a message, once a page with a successor has been filed', () => {
    expect(
      inboxBody({ ...base, rowCount: 0, nextCursor: '2026-09-07T10:00:00.000000Z~x' }),
    ).toEqual({ kind: 'list', pageEmptied: true });
  });

  it('explains what private feedback is when nothing has ever arrived', () => {
    expect(inboxBody({ ...base, rowCount: 0, total: 0 })).toEqual({
      kind: 'never-received',
      pageEmptied: false,
    });
  });

  /**
   * The counts are scoped to the date range, so a total of zero inside one is not evidence that
   * nothing ever arrived — the never-received copy would be an unbacked claim about the tenant.
   */
  it('does not read an empty date range as an empty inbox', () => {
    expect(inboxBody({ ...base, rowCount: 0, total: 0, hasDateFilter: true })).toEqual({
      kind: 'no-matches',
      pageEmptied: false,
    });
  });

  it('reports a filter with no matches when the business has feedback elsewhere', () => {
    expect(inboxBody({ ...base, rowCount: 0, total: 12 })).toEqual({
      kind: 'no-matches',
      pageEmptied: false,
    });
  });
});

describe('messagePreview', () => {
  it('leaves a short message alone', () => {
    expect(messagePreview('Lovely coffee.')).toBe('Lovely coffee.');
  });

  it('collapses the line breaks a customer typed into one line', () => {
    expect(messagePreview('First line.\n\n  Second line.')).toBe('First line. Second line.');
  });

  /**
   * `private_feedback.message` is free text from a consumer, so an emoji is ordinary here. Slicing
   * a JavaScript string would split its surrogate pair and render a replacement character.
   */
  it('cuts on a code point rather than a UTF-16 unit', () => {
    const preview = messagePreview('👍👍👍👍', 3);
    expect(preview).toBe('👍👍👍…');
    expect(preview).not.toContain('�');
  });

  it('appends a single ellipsis character rather than three dots', () => {
    const preview = messagePreview('a'.repeat(200));
    expect(preview.endsWith('…')).toBe(true);
    expect(preview).not.toContain('...');
  });
});

describe('isFeedbackStatus', () => {
  it.each(['NEW', 'READ', 'ARCHIVED'])('accepts %s', (value) => {
    expect(isFeedbackStatus(value)).toBe(true);
  });

  /** The wire carries the database's spelling, which is what the PATCH endpoint accepts back. */
  it.each(['new', 'Read', 'DELETED', '', 'constructor', 42, null, undefined])(
    'rejects %p',
    (value) => {
      expect(isFeedbackStatus(value)).toBe(false);
    },
  );
});

describe('readFeedbackPage', () => {
  it('reads a well-formed page', () => {
    const page = readFeedbackPage({ feedback: [wireItem()], next_cursor: null });
    expect(page?.items).toHaveLength(1);
    expect(page?.nextCursor).toBeNull();
  });

  it('carries a cursor through when there are more pages', () => {
    const page = readFeedbackPage({ feedback: [], next_cursor: `x~${ID}` });
    expect(page?.nextCursor).toBe(`x~${ID}`);
  });

  it('turns absent contact details into nulls rather than undefined', () => {
    const page = readFeedbackPage({
      feedback: [{ ...wireItem(), name: null, mobile: null }],
      next_cursor: null,
    });
    expect(page?.items[0]?.name).toBeNull();
    expect(page?.items[0]?.mobile).toBeNull();
  });

  it.each([
    ['a body that is not an object', 'nope'],
    ['a missing feedback array', { next_cursor: null }],
    ['a feedback value that is not an array', { feedback: {}, next_cursor: null }],
    ['a cursor that is neither string nor null', { feedback: [], next_cursor: 7 }],
  ])('rejects %s', (_case, payload) => {
    expect(readFeedbackPage(payload)).toBeNull();
  });

  it.each([
    ['an unknown status', { status: 'DELETED' }],
    ['a missing message', { message: 42 }],
    ['an unparseable timestamp', { created_at: 'last Tuesday' }],
    ['a missing cursor', { cursor: null }],
  ])('rejects a page containing a row with %s', (_case, overrides) => {
    const payload = { feedback: [{ ...wireItem(), ...overrides }], next_cursor: null };
    expect(readFeedbackPage(payload)).toBeNull();
  });
});

describe('shiftCounts', () => {
  const counts = { ...emptyFeedbackCounts(), new: 3, read: 5, archived: 2, total: 10 };

  it('moves one message between two statuses', () => {
    expect(shiftCounts(counts, 'NEW', 'READ')).toEqual({
      new: 2,
      read: 6,
      archived: 2,
      total: 10,
    });
  });

  /** Archiving is filing, not deleting: the business has still received the same ten messages. */
  it('leaves the total alone when a message is archived', () => {
    expect(shiftCounts(counts, 'READ', 'ARCHIVED').total).toBe(10);
  });

  it('is a no-op when the status has not changed', () => {
    expect(shiftCounts(counts, 'READ', 'READ')).toBe(counts);
  });

  /** Another tab may have filed the same message first; a negative chip is worse than a stale one. */
  it('clamps at zero', () => {
    const drained = { ...emptyFeedbackCounts(), read: 1, total: 1 };
    expect(shiftCounts(drained, 'NEW', 'READ').new).toBe(0);
  });

  it('does not mutate the counts it was given', () => {
    const before = { ...counts };
    shiftCounts(counts, 'NEW', 'ARCHIVED');
    expect(counts).toEqual(before);
  });
});

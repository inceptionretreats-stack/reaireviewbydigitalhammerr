import { describe, expect, it } from 'vitest';
import { customerOptionLabel, describeRequest, formatDateTime } from '../presentation';

/**
 * REQ-01's wording, which is where AC-023 and AC-025 are either satisfied or not.
 *
 * The badge labels are the only place this screen makes a claim about what happened, so they are
 * asserted rather than reviewed.
 */

const PREPARED = { markedSentAtLabel: null, firstClickedAtLabel: null };

describe('describeRequest', () => {
  it('describes a request nobody has acted on yet', () => {
    expect(describeRequest(PREPARED)).toEqual([{ tone: 'neutral', label: 'Prepared' }]);
  });

  it('attributes the send to the owner, never to the platform (AC-023)', () => {
    // "Sent" alone would read as the platform having sent it, which it cannot do (D-017, ADR-004).
    expect(describeRequest({ ...PREPARED, markedSentAtLabel: '7 Sept 2026, 4:20 pm' })).toEqual([
      { tone: 'success', label: 'Marked sent by you' },
    ]);
  });

  it('reports an opened link as its own separate fact', () => {
    // Independent of marking: an owner can forget to mark a message they did send, and a customer can
    // open a link that was never marked.
    expect(describeRequest({ ...PREPARED, firstClickedAtLabel: '7 Sept 2026, 5:01 pm' })).toEqual([
      { tone: 'neutral', label: 'Prepared' },
      { tone: 'accent', label: 'Link opened' },
    ]);
  });

  it('shows both facts when both are true, marking first', () => {
    const badges = describeRequest({
      markedSentAtLabel: '7 Sept 2026, 4:20 pm',
      firstClickedAtLabel: '7 Sept 2026, 5:01 pm',
    });

    expect(badges.map((badge) => badge.label)).toEqual(['Marked sent by you', 'Link opened']);
  });

  it('never claims a review exists (D-028, AC-025)', () => {
    // The furthest observable fact is that the link was opened. No label may imply more.
    const labels = [
      ...describeRequest(PREPARED),
      ...describeRequest({
        markedSentAtLabel: 'x',
        firstClickedAtLabel: 'y',
      }),
    ].map((badge) => badge.label);

    for (const label of labels) {
      expect(label).not.toMatch(/review|google|posted|submit|star/i);
    }
  });

  it('always returns at least one badge, so a status cell is never blank', () => {
    expect(describeRequest(PREPARED).length).toBeGreaterThan(0);
  });
});

describe('formatDateTime', () => {
  const INSTANT = '2026-09-07T10:50:00.000Z';

  it('formats in the business timezone, not the reader’s (AMENDMENT-004, AC-026)', () => {
    const kolkata = formatDateTime(INSTANT, 'Asia/Kolkata');
    const utc = formatDateTime(INSTANT, 'UTC');

    expect(kolkata).not.toBe(utc);
    // 10:50 UTC is 16:20 in Asia/Kolkata. Asserting the hour rather than the whole string keeps this
    // from breaking on an ICU punctuation change.
    expect(kolkata).toContain('4:20');
  });

  it('falls back rather than throwing on an unrecognised timezone', () => {
    // businesses.timezone is free text, so this is reachable and must not take the screen down.
    expect(formatDateTime(INSTANT, 'Mars/Olympus_Mons')).not.toBe('');
  });

  it('returns an empty string for an unparseable instant', () => {
    expect(formatDateTime('not-a-date', 'UTC')).toBe('');
  });
});

describe('customerOptionLabel', () => {
  it('shows the number, because two customers share a first name often enough', () => {
    expect(customerOptionLabel('Priya', '+919876543210')).toBe('Priya — +919876543210');
  });

  it('omits the separator when there is no number to show', () => {
    expect(customerOptionLabel('Priya', '  ')).toBe('Priya');
  });
});

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FEEDBACK_FILTERS,
  DEFAULT_PAGE_SIZE,
  DEFAULT_TIME_ZONE,
  MAX_PAGE_SIZE,
  encodeFeedbackCursor,
  feedbackApiHref,
  feedbackQueryString,
  feedbackScreenHref,
  isDefaultFilters,
  parseFeedbackCursor,
  parseFeedbackFilters,
  parseFeedbackPageRequest,
  resolveTimeZone,
  statusesFor,
  todayInZone,
  zonedDayRange,
  type FeedbackFilters,
} from '../filters';

/**
 * FB-02's filters, and the AC-026 boundary arithmetic behind them.
 *
 * The date tests pin exact instants rather than checking that "something came back", because the
 * whole point of AC-026 is that a merchant's "yesterday" is their own clock's yesterday — an
 * off-by-one here silently hides or reveals a customer's message.
 */

const KOLKATA = 'Asia/Kolkata';
const NEW_YORK = 'America/New_York';

function filters(overrides: Partial<FeedbackFilters> = {}): FeedbackFilters {
  return { ...DEFAULT_FEEDBACK_FILTERS, ...overrides };
}

describe('parseFeedbackFilters', () => {
  it('defaults to the inbox with no date bounds', () => {
    expect(parseFeedbackFilters({})).toEqual({
      filters: { status: 'inbox', from: null, to: null },
      rejected: [],
    });
  });

  it('reads the same values from URLSearchParams and from a params record', () => {
    const query = 'status=archived&from=2026-01-01&to=2026-01-31';
    expect(parseFeedbackFilters(new URLSearchParams(query))).toEqual(
      parseFeedbackFilters({ status: 'archived', from: '2026-01-01', to: '2026-01-31' }),
    );
  });

  it('accepts a status in any case', () => {
    expect(parseFeedbackFilters({ status: 'ARCHIVED' }).filters.status).toBe('archived');
  });

  it('reports an unknown status and falls back to the default', () => {
    const parsed = parseFeedbackFilters({ status: 'unread' });
    expect(parsed.filters.status).toBe('inbox');
    expect(parsed.rejected).toEqual(['status']);
  });

  /** Clearing the date pickers on a GET form submits empty strings; that is not a malformed URL. */
  it('treats empty date parameters as absent rather than invalid', () => {
    expect(parseFeedbackFilters({ status: '', from: '', to: '' })).toEqual({
      filters: { status: 'inbox', from: null, to: null },
      rejected: [],
    });
  });

  it('reports a malformed date', () => {
    const parsed = parseFeedbackFilters({ from: '07-09-2026' });
    expect(parsed.filters.from).toBeNull();
    expect(parsed.rejected).toEqual(['from']);
  });

  /** `Date.UTC` would roll this to 2 March and quietly filter on a day nobody asked for. */
  it('reports a date that matches the pattern but is not a real day', () => {
    expect(parseFeedbackFilters({ to: '2026-02-30' }).rejected).toEqual(['to']);
  });

  it('drops an inverted range whole rather than half-applying it', () => {
    const parsed = parseFeedbackFilters({ from: '2026-03-10', to: '2026-03-01' });
    expect(parsed.filters).toEqual({ status: 'inbox', from: null, to: null });
    expect(parsed.rejected).toEqual(['from', 'to']);
  });

  it('accepts a single-day range', () => {
    const parsed = parseFeedbackFilters({ from: '2026-03-10', to: '2026-03-10' });
    expect(parsed.rejected).toEqual([]);
    expect(parsed.filters.from).toBe('2026-03-10');
  });

  it('takes the first value when a parameter is repeated', () => {
    expect(parseFeedbackFilters(new URLSearchParams('status=new&status=all')).filters.status).toBe(
      'new',
    );
  });
});

describe('statusesFor', () => {
  /**
   * The load-bearing one. Archive is filing, not deleting: an archived message must leave the
   * default view, or the action does nothing visible, and must still be reachable elsewhere.
   */
  it('keeps archived messages out of the inbox but reachable', () => {
    expect(statusesFor('inbox')).toEqual(['NEW', 'READ']);
    expect(statusesFor('archived')).toEqual(['ARCHIVED']);
    expect(statusesFor('all')).toContain('ARCHIVED');
  });

  it('never returns an empty set', () => {
    for (const filter of ['inbox', 'new', 'read', 'archived', 'all'] as const) {
      expect(statusesFor(filter).length).toBeGreaterThan(0);
    }
  });
});

describe('zonedDayRange', () => {
  it('is unbounded when no dates are given', () => {
    expect(zonedDayRange(filters(), KOLKATA)).toEqual({
      startInclusive: null,
      endExclusive: null,
    });
  });

  /** AC-026: IST is UTC+05:30, so a local day starts at 18:30 UTC the day before. */
  it('starts a Kolkata day at 18:30 UTC the previous day', () => {
    const range = zonedDayRange(filters({ from: '2026-09-07' }), KOLKATA);
    expect(range.startInclusive?.toISOString()).toBe('2026-09-06T18:30:00.000Z');
  });

  it('ends the range at the start of the day after `to`, so `to` itself is included', () => {
    const range = zonedDayRange(filters({ to: '2026-09-07' }), KOLKATA);
    expect(range.endExclusive?.toISOString()).toBe('2026-09-07T18:30:00.000Z');
  });

  it('crosses a year end when adding the exclusive day', () => {
    const range = zonedDayRange(filters({ to: '2026-12-31' }), KOLKATA);
    expect(range.endExclusive?.toISOString()).toBe('2026-12-31T18:30:00.000Z');
  });

  /**
   * India has no DST, so a zone that does is the only way to prove the second correction pass in
   * `zonedMidnight` is doing anything. 1 November 2026 is the US fall-back date: the day begins on
   * EDT (UTC-4) and the day after it begins on EST (UTC-5), so a single-offset implementation gets
   * one of these two wrong.
   */
  it('reads both sides of a fall-back transition correctly', () => {
    const range = zonedDayRange(filters({ from: '2026-11-01', to: '2026-11-01' }), NEW_YORK);
    expect(range.startInclusive?.toISOString()).toBe('2026-11-01T04:00:00.000Z');
    expect(range.endExclusive?.toISOString()).toBe('2026-11-02T05:00:00.000Z');
  });

  /** 8 March 2026 is the spring-forward date; local midnight is still EST. */
  it('reads both sides of a spring-forward transition correctly', () => {
    const range = zonedDayRange(filters({ from: '2026-03-08', to: '2026-03-08' }), NEW_YORK);
    expect(range.startInclusive?.toISOString()).toBe('2026-03-08T05:00:00.000Z');
    expect(range.endExclusive?.toISOString()).toBe('2026-03-09T04:00:00.000Z');
  });

  it('agrees with UTC when the zone is UTC', () => {
    const range = zonedDayRange(filters({ from: '2026-09-07', to: '2026-09-07' }), 'UTC');
    expect(range.startInclusive?.toISOString()).toBe('2026-09-07T00:00:00.000Z');
    expect(range.endExclusive?.toISOString()).toBe('2026-09-08T00:00:00.000Z');
  });
});

describe('resolveTimeZone', () => {
  it('keeps a valid IANA zone', () => {
    expect(resolveTimeZone(NEW_YORK)).toBe(NEW_YORK);
  });

  /**
   * `businesses.timezone` is a free-text column (AMENDMENT-004). AC-026 names Asia/Kolkata as the
   * documented default, and the same fallback has to serve the query boundary and the rendered
   * timestamp or a row could be listed showing a date outside the range that selected it.
   */
  it.each([null, undefined, '', '   ', 'Mars/Olympus_Mons'])(
    'falls back to the documented default for %p',
    (value) => {
      expect(resolveTimeZone(value)).toBe(DEFAULT_TIME_ZONE);
    },
  );
});

describe('todayInZone', () => {
  it('reports the tenant’s date, not the server’s', () => {
    const evening = new Date('2026-09-07T20:00:00Z');
    expect(todayInZone(KOLKATA, evening)).toBe('2026-09-08');
    expect(todayInZone('UTC', evening)).toBe('2026-09-07');
  });

  it('pads single-digit months and days', () => {
    expect(todayInZone('UTC', new Date('2026-01-05T12:00:00Z'))).toBe('2026-01-05');
  });
});

describe('feedback cursors', () => {
  it('round-trips a full-precision timestamp', () => {
    const cursor = {
      at: '2026-09-07T10:11:12.123456Z',
      id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
    };
    expect(parseFeedbackCursor(encodeFeedbackCursor(cursor))).toEqual(cursor);
  });

  it('accepts a timestamp with no fractional seconds', () => {
    const raw = '2026-09-07T10:11:12Z~3f2504e0-4f89-41d3-9a0c-0305e82c3301';
    expect(parseFeedbackCursor(raw)).not.toBeNull();
  });

  it.each([
    ['no separator', '2026-09-07T10:11:12Z'],
    ['a local timestamp', '2026-09-07 10:11:12~3f2504e0-4f89-41d3-9a0c-0305e82c3301'],
    ['a non-uuid id', '2026-09-07T10:11:12Z~42'],
    ['an injected fragment', "2026-09-07T10:11:12Z~') or true--"],
    ['nothing at all', ''],
  ])('rejects %s', (_case, raw) => {
    expect(parseFeedbackCursor(raw)).toBeNull();
  });
});

describe('parseFeedbackPageRequest', () => {
  it('defaults to one screenful and no cursor', () => {
    expect(parseFeedbackPageRequest({})).toEqual({
      limit: DEFAULT_PAGE_SIZE,
      cursor: null,
      rejected: [],
    });
  });

  it('accepts a limit inside the ceiling', () => {
    expect(parseFeedbackPageRequest({ limit: String(MAX_PAGE_SIZE) }).limit).toBe(MAX_PAGE_SIZE);
  });

  /** Rejected rather than clamped, so a caller asking for 500 finds out instead of guessing. */
  it.each(['0', '-5', '500', '10.5', 'twenty'])('reports limit=%s', (limit) => {
    const parsed = parseFeedbackPageRequest({ limit });
    expect(parsed.rejected).toEqual(['limit']);
    expect(parsed.limit).toBe(DEFAULT_PAGE_SIZE);
  });

  it('reports an unparseable cursor', () => {
    expect(parseFeedbackPageRequest({ cursor: 'nonsense' }).rejected).toEqual(['cursor']);
  });
});

describe('links', () => {
  it('omits everything already at its default', () => {
    expect(feedbackQueryString(DEFAULT_FEEDBACK_FILTERS)).toBe('');
    expect(feedbackScreenHref(DEFAULT_FEEDBACK_FILTERS)).toBe('/app/feedback');
    expect(feedbackApiHref(DEFAULT_FEEDBACK_FILTERS)).toBe('/api/v1/feedback');
  });

  it('carries the filters and cursor the caller set', () => {
    const href = feedbackApiHref(filters({ status: 'archived', from: '2026-01-01' }), {
      cursor: '2026-01-01T00:00:00Z~3f2504e0-4f89-41d3-9a0c-0305e82c3301',
    });
    const params = new URLSearchParams(href.split('?')[1] ?? '');
    expect(params.get('status')).toBe('archived');
    expect(params.get('from')).toBe('2026-01-01');
    expect(params.get('cursor')).toBe('2026-01-01T00:00:00Z~3f2504e0-4f89-41d3-9a0c-0305e82c3301');
    expect(params.get('limit')).toBeNull();
  });

  it('round-trips through the parser', () => {
    const wanted = filters({ status: 'all', from: '2026-02-01', to: '2026-02-28' });
    const query = feedbackScreenHref(wanted).split('?')[1] ?? '';
    expect(parseFeedbackFilters(new URLSearchParams(query))).toEqual({
      filters: wanted,
      rejected: [],
    });
  });

  it('recognises the default filter set', () => {
    expect(isDefaultFilters(DEFAULT_FEEDBACK_FILTERS)).toBe(true);
    expect(isDefaultFilters(filters({ to: '2026-02-28' }))).toBe(false);
    expect(isDefaultFilters(filters({ status: 'all' }))).toBe(false);
  });
});

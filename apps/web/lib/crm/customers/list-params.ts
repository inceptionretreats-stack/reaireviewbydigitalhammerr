import type { PhoneRejection } from '@ai-review/core';

/**
 * Request-side helpers shared by both `/customers` handlers.
 *
 * Pure and framework-free so the search and pagination rules can be tested without a database:
 * they are the part of a list endpoint that is easy to get subtly wrong (a page past the end that
 * returns nothing, a `%` in the search box that matches every row) and impossible to notice.
 */

/** CRM-01 is a contact list, not a mailing list. A screen's worth of rows, not a spreadsheet. */
export const DEFAULT_PAGE_SIZE = 25;

/**
 * A hard ceiling on `per_page`, so no single request can ask for a tenant's whole contact list as
 * one response. The client never sends more than DEFAULT_PAGE_SIZE; this exists because the
 * parameter is attacker-controlled and `LIMIT` is the only thing bounding the response size.
 */
export const MAX_PAGE_SIZE = 100;

/**
 * Longer than any name, and short enough that the LIKE pattern stays cheap. A search box is not
 * an input for prose, and an unbounded pattern is an unbounded scan.
 */
export const MAX_SEARCH_LENGTH = 120;

/**
 * Below this, digits in the search box are treated as text rather than as part of a phone number.
 *
 * Mobile numbers are stored E.164, so a one- or two-digit fragment matches most of the list and
 * tells the owner nothing. Three is where the answer starts to be useful.
 */
export const MIN_MOBILE_SEARCH_DIGITS = 3;

export interface ListQuery {
  /** 1-based, as it is shown to the owner. Clamped to the last page once the total is known. */
  page: number;
  perPage: number;
  /** Trimmed and capped. Empty means no filter at all rather than a match-everything pattern. */
  search: string;
  /**
   * The digits of `search`, when there are enough of them to be a phone fragment; otherwise null.
   *
   * Separate from `search` because a stored number is `+919876543210` while an owner types
   * `98765 43210`, `+91 98765` or `091-9876543210`. Comparing digits to digits is what makes any of
   * those find the row (CRM-01-03).
   *
   * Leading zeros are dropped, which is why `091-9876543210` and `00919876543210` both find
   * `+919876543210`: a domestic trunk prefix or an international access code is how an Indian number
   * is written down, and an E.164 value never begins with a zero, so nothing is lost by removing it.
   */
  mobileDigits: string | null;
}

export function parseListQuery(params: URLSearchParams): ListQuery {
  const search = (params.get('q') ?? '').trim().slice(0, MAX_SEARCH_LENGTH);
  const digits = digitsOf(search).replace(/^0+/, '');

  return {
    page: positiveInteger(params.get('page'), 1),
    perPage: Math.min(positiveInteger(params.get('per_page'), DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE),
    search,
    mobileDigits: digits.length >= MIN_MOBILE_SEARCH_DIGITS ? digits : null,
  };
}

/**
 * How many pages the result set has. Always at least one, so an empty list is "page 1 of 1" rather
 * than "page 1 of 0", which reads as a bug to the owner and as an off-by-one to the client.
 */
export function totalPages(total: number, perPage: number): number {
  return Math.max(1, Math.ceil(total / Math.max(1, perPage)));
}

/**
 * The page actually served.
 *
 * Clamped rather than honoured, because the common way to land past the end is to delete the last
 * contact on the last page: the client asks for page 3 of what is now 2, and an unclamped endpoint
 * answers with an empty table and no explanation. The response echoes this value so the client can
 * correct itself.
 */
export function resolvePage(requested: number, total: number, perPage: number): number {
  return Math.min(Math.max(1, requested), totalPages(total, perPage));
}

/**
 * Escapes the LIKE metacharacters so a search box cannot inject a pattern.
 *
 * `%` alone would otherwise match every contact while appearing to be a search, and `_` would
 * quietly match any single character. Backslash goes first — it is Postgres's default LIKE escape
 * character, so escaping it after the others would double-escape their new backslashes.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/** A `%…%` LIKE pattern for a user-supplied fragment. */
export function containsPattern(value: string): string {
  return `%${escapeLikePattern(value)}%`;
}

export function digitsOf(value: string): string {
  return value.replace(/\D/g, '');
}

/**
 * Checked before an id reaches a query, because a non-uuid makes Postgres raise 22P02 — which would
 * surface as a 500 for what is plainly a request for something that does not exist. Same guard as
 * `/qr/{id}/download`, for the same reason.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/**
 * Copy for the rejection codes `normalizePhone` returns (CRM-01-03).
 *
 * India-first (D-002), so the guidance names the 10-digit case an owner is almost certainly typing.
 * Kept beside the endpoint rather than in the form, so the message is the same whether the browser
 * catches it or the server does — the form mirrors the rule, and the server is what enforces it.
 */
export function describePhoneRejection(reason: PhoneRejection): string {
  switch (reason) {
    case 'EMPTY':
      return 'Enter their mobile number.';
    case 'TOO_SHORT':
      return 'That number looks too short. Enter a 10-digit Indian mobile number.';
    case 'TOO_LONG':
      return 'That number looks too long. Enter a 10-digit Indian mobile number.';
    case 'INVALID_INDIAN_MOBILE':
      return 'Enter a 10-digit Indian mobile number starting with 6, 7, 8 or 9.';
  }
}

/**
 * Parses a positive integer parameter, falling back for anything that is not one.
 *
 * A junk `page=abc` or `page=-4` is treated as absent rather than rejected: neither is worth a 422
 * on a list endpoint, and refusing would mean a stale bookmark shows an error instead of a list.
 */
function positiveInteger(raw: string | null, fallback: number): number {
  if (raw === null) return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return fallback;
  return parsed;
}

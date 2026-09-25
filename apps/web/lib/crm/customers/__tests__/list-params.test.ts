import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  MAX_SEARCH_LENGTH,
  containsPattern,
  digitsOf,
  escapeLikePattern,
  isUuid,
  parseListQuery,
  resolvePage,
  totalPages,
} from '../list-params';

const query = (search: string) => `?${search}`;

describe('CRM-01 list query', () => {
  it('defaults to the first page with no filter', () => {
    expect(parseListQuery(new URLSearchParams())).toEqual({
      page: 1,
      perPage: DEFAULT_PAGE_SIZE,
      search: '',
      mobileDigits: null,
    });
  });

  it('caps per_page, so no request can ask for the whole contact list at once', () => {
    const parsed = parseListQuery(new URLSearchParams(query(`per_page=${MAX_PAGE_SIZE + 500}`)));
    expect(parsed.perPage).toBe(MAX_PAGE_SIZE);
  });

  it('treats a junk or out-of-range page as absent rather than as an error', () => {
    // A stale bookmark should show a list, not a 422.
    for (const raw of ['abc', '0', '-3', '1.5', '']) {
      expect(parseListQuery(new URLSearchParams(query(`page=${raw}`))).page).toBe(1);
    }
  });

  it('trims the search text and caps its length', () => {
    expect(parseListQuery(new URLSearchParams(query('q=%20%20asha%20%20'))).search).toBe('asha');

    const long = parseListQuery(new URLSearchParams(query(`q=${'a'.repeat(400)}`)));
    expect(long.search).toHaveLength(MAX_SEARCH_LENGTH);
  });
});

describe('CRM-01 search treats digits as a phone fragment (CRM-01-03)', () => {
  it('extracts the digits an owner typed, however they typed them', () => {
    // The column holds E.164, so these all have to reach '%919876543210%'.
    for (const typed of ['+91 98765 43210', '091-9876543210', '(91) 9876543210']) {
      const parsed = parseListQuery(new URLSearchParams(query(`q=${encodeURIComponent(typed)}`)));
      expect(parsed.mobileDigits).toBe('919876543210');
    }
  });

  it('matches on a partial number, which is how an owner actually searches', () => {
    expect(parseListQuery(new URLSearchParams(query('q=98765'))).mobileDigits).toBe('98765');
  });

  it('ignores one or two stray digits, which would match most of the list', () => {
    expect(parseListQuery(new URLSearchParams(query('q=12'))).mobileDigits).toBeNull();
    expect(parseListQuery(new URLSearchParams(query('q=Shop%202'))).mobileDigits).toBeNull();
  });

  it('leaves a plain name alone', () => {
    const parsed = parseListQuery(new URLSearchParams(query('q=Asha')));
    expect(parsed).toMatchObject({ search: 'Asha', mobileDigits: null });
  });
});

describe('LIKE escaping', () => {
  it('stops a wildcard in the search box matching every contact', () => {
    expect(containsPattern('%')).toBe(String.raw`%\%%`);
    expect(containsPattern('_')).toBe(String.raw`%\_%`);
  });

  it('escapes the backslash first, so the other escapes are not doubled', () => {
    expect(escapeLikePattern(String.raw`\%_`)).toBe(String.raw`\\\%\_`);
  });

  it('leaves ordinary text untouched', () => {
    expect(escapeLikePattern("O'Brien & Co.")).toBe("O'Brien & Co.");
  });
});

describe('paging arithmetic', () => {
  it('always reports at least one page, so an empty list is not "page 1 of 0"', () => {
    expect(totalPages(0, DEFAULT_PAGE_SIZE)).toBe(1);
  });

  it('counts a partial last page', () => {
    expect(totalPages(25, 25)).toBe(1);
    expect(totalPages(26, 25)).toBe(2);
    expect(totalPages(100, 25)).toBe(4);
  });

  it('clamps a page past the end back onto the last one', () => {
    // The way this happens in practice: the owner deletes the last contact on the last page.
    expect(resolvePage(3, 26, 25)).toBe(2);
    expect(resolvePage(9, 0, 25)).toBe(1);
  });

  it('never returns a page below one', () => {
    expect(resolvePage(0, 100, 25)).toBe(1);
  });
});

describe('id validation', () => {
  it('accepts a uuid in either case', () => {
    expect(isUuid('7c9e6679-7425-40de-944b-e07fc1f90ae7')).toBe(true);
    expect(isUuid('7C9E6679-7425-40DE-944B-E07FC1F90AE7')).toBe(true);
  });

  it('rejects anything that would make Postgres raise 22P02', () => {
    for (const raw of ['', 'abc', '7c9e6679', "1' OR '1'='1", '7c9e6679-7425-40de-944b']) {
      expect(isUuid(raw)).toBe(false);
    }
  });
});

describe('digit extraction', () => {
  it('keeps only digits', () => {
    expect(digitsOf('+91 98765-43210')).toBe('919876543210');
    expect(digitsOf('Asha')).toBe('');
  });
});

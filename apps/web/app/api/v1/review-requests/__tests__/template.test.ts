import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TEMPLATE_TEXT,
  SAMPLE_TRACKING_TOKEN,
  TEMPLATE_VARIABLES,
  buildTrackedRequestUrl,
  findTrackedRequestUrl,
  isTemplateVariable,
  isTrackingTokenFormat,
  renderTemplate,
  unknownVariables,
} from '../template';

/**
 * The message renderer (Flow F step 3) and the tracked-link helpers (Flow F step 9, OPEN-02).
 *
 * Everything here is pure, so these are the tests that can actually assert behaviour rather than
 * mock a database into agreeing with itself.
 */

const VALUES = {
  customer_name: 'Priya',
  business_name: 'Sunrise Dental',
  review_link: 'https://review.digitalhammerr.com/sunrise/review',
} as const;

describe('renderTemplate', () => {
  it('substitutes all three variables Flow F names', () => {
    const rendered = renderTemplate(
      'Hi {customer_name}, thanks for visiting {business_name}: {review_link}',
      VALUES,
    );

    expect(rendered).toBe(
      'Hi Priya, thanks for visiting Sunrise Dental: https://review.digitalhammerr.com/sunrise/review',
    );
  });

  it('substitutes a variable used more than once', () => {
    expect(renderTemplate('{customer_name}, hello {customer_name}', VALUES)).toBe(
      'Priya, hello Priya',
    );
  });

  it('leaves an unrecognised placeholder exactly as written', () => {
    // Deleting part of the owner's text because the platform did not recognise it is the worse
    // failure: they can see and fix a visible {name}, but not something that vanished.
    expect(renderTemplate('Hi {name}, from {business_name}', VALUES)).toBe(
      'Hi {name}, from Sunrise Dental',
    );
  });

  it('does not expand a placeholder that arrives inside a value', () => {
    // A customer saved as "{review_link}" must not make their own name resolve to the tracked link.
    const rendered = renderTemplate('Hi {customer_name}', {
      ...VALUES,
      customer_name: '{review_link}',
    });

    expect(rendered).toBe('Hi {review_link}');
  });

  it('is case-sensitive, so a mis-cased variable is not silently substituted', () => {
    expect(renderTemplate('Hi {Customer_Name}', VALUES)).toBe('Hi {Customer_Name}');
  });
});

describe('unknownVariables', () => {
  it('reports only placeholders the renderer will not substitute', () => {
    expect(unknownVariables('{customer_name} {name} {business_name} {visit_date}')).toEqual([
      'name',
      'visit_date',
    ]);
  });

  it('reports a mis-cased variable, because that is what an owner actually types', () => {
    expect(unknownVariables('Hi {Customer_Name}')).toEqual(['Customer_Name']);
  });

  it('reports each name once, in first-seen order', () => {
    expect(unknownVariables('{b} {a} {b}')).toEqual(['b', 'a']);
  });

  it('finds nothing in a template using only supported variables', () => {
    expect(unknownVariables(DEFAULT_TEMPLATE_TEXT)).toEqual([]);
  });
});

describe('the seeded default template', () => {
  it('uses every variable, so a seeded tenant gets a complete message', () => {
    for (const variable of TEMPLATE_VARIABLES) {
      expect(DEFAULT_TEMPLATE_TEXT).toContain(`{${variable}}`);
    }
    expect(isTemplateVariable('review_link')).toBe(true);
  });

  it('asks for no rating and no score (D-009, AC-006)', () => {
    // The customer is never asked to rate anything anywhere before Google, so the message this
    // product puts in an owner's mouth must not either.
    expect(DEFAULT_TEMPLATE_TEXT).not.toMatch(/\bstars?\b|\brate\b|\brating\b|out of (five|5)/i);
  });

  it('claims nothing about a review existing (D-028, AC-025)', () => {
    // The platform can only ever observe that Google was opened, so the invitation must not talk
    // about a review having been given, posted or submitted.
    expect(DEFAULT_TEMPLATE_TEXT).not.toMatch(/\bsubmit|\bposted\b|\bleft a review\b/i);
  });

  it('does not imply the platform sends it (D-017, ADR-004, REQ-01-02)', () => {
    expect(DEFAULT_TEMPLATE_TEXT).not.toMatch(/\bwe (?:have )?sent\b|on behalf of/i);
  });
});

describe('tracked links', () => {
  const BASE = 'https://review.digitalhammerr.com';

  it('builds the resolver path the public route serves', () => {
    expect(buildTrackedRequestUrl(BASE, SAMPLE_TRACKING_TOKEN)).toBe(
      `${BASE}/r/req/${SAMPLE_TRACKING_TOKEN}`,
    );
  });

  it('recovers the link from a stored message', () => {
    const url = buildTrackedRequestUrl(BASE, SAMPLE_TRACKING_TOKEN);
    expect(findTrackedRequestUrl(`Hi Priya, here you go: ${url}`)).toBe(url);
  });

  it('stops at trailing punctuation rather than swallowing it', () => {
    const url = buildTrackedRequestUrl(BASE, SAMPLE_TRACKING_TOKEN);
    expect(findTrackedRequestUrl(`Open ${url}. Thank you!`)).toBe(url);
  });

  it('returns null when the owner left the link out of their template', () => {
    expect(findTrackedRequestUrl('Hi Priya, thanks for visiting Sunrise Dental.')).toBeNull();
  });
});

describe('isTrackingTokenFormat', () => {
  it('accepts what issueToken produces', () => {
    expect(SAMPLE_TRACKING_TOKEN).toHaveLength(43);
    expect(isTrackingTokenFormat(SAMPLE_TRACKING_TOKEN)).toBe(true);
    expect(isTrackingTokenFormat('a-b_C9'.repeat(8))).toBe(true);
  });

  it('rejects anything that could add a path segment or a traversal', () => {
    expect(isTrackingTokenFormat('../../etc/passwd')).toBe(false);
    expect(isTrackingTokenFormat(`${SAMPLE_TRACKING_TOKEN}/extra`)).toBe(false);
    expect(isTrackingTokenFormat(`${SAMPLE_TRACKING_TOKEN}.json`)).toBe(false);
  });

  it('rejects a token too short to be one', () => {
    expect(isTrackingTokenFormat('short')).toBe(false);
    expect(isTrackingTokenFormat('')).toBe(false);
  });
});

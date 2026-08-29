import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EVENT_NAMES, EVENT_SPECS, FUNNEL_EVENTS, validateEvent } from '../index';

const here = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = resolve(here, '../../../../docs/spec/11_Analytics_Event_Taxonomy.csv');

describe('analytics taxonomy', () => {
  it('stays in sync with the delivered CSV contract', () => {
    const rows = readFileSync(CSV_PATH, 'utf8').trim().split(/\r?\n/).slice(1);
    const csvNames = rows.map((line) => line.split(',')[0]!.trim());

    expect([...EVENT_NAMES]).toEqual(csvNames);
  });

  it('rejects an event name outside the taxonomy', () => {
    const result = validateEvent('review_submitted', { business_id: 'b1' });
    expect(result.ok).toBe(false);
  });

  it('rejects a payload missing a required property', () => {
    const result = validateEvent('google_open', { business_id: 'b1' });
    expect(result).toMatchObject({ ok: false });
  });

  it('rejects a property the taxonomy does not declare', () => {
    const result = validateEvent('google_open', {
      business_id: 'b1',
      anonymous_session_id: 's1',
      star_rating: 5,
    });
    expect(result).toMatchObject({ ok: false });
  });

  it('accepts a well-formed event', () => {
    const result = validateEvent('google_open', {
      business_id: 'b1',
      anonymous_session_id: 's1',
      generation_id: 'g1',
    });
    expect(result).toMatchObject({ ok: true });
  });

  /**
   * D-028 / AC-025 / 13_Security_Privacy_Compliance.md rule 8. The platform can only observe
   * that Google was opened. No event may imply the review was submitted, and no event may
   * carry a star rating, because the customer is never asked for one (D-009).
   */
  it('contains no event claiming submission and no rating property', () => {
    for (const name of EVENT_NAMES) {
      expect(name).not.toMatch(/submit(ted)?_review|review_submitted/i);
    }

    const allProps = Object.values(EVENT_SPECS).flatMap((s) => [...s.required, ...s.optional]);
    for (const prop of allProps) {
      expect(prop).not.toMatch(/star|rating/i);
    }
  });

  it('ends the funnel at google_open', () => {
    expect(FUNNEL_EVENTS.at(-1)).toBe('google_open');
  });
});

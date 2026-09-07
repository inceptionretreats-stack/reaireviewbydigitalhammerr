import { describe, expect, it } from 'vitest';
import * as copy from '../copy';

/**
 * A compliance test, not a snapshot.
 *
 * The AI screens are where a well-meaning edit is most likely to promise something the product must
 * never promise: a mode that guarantees positive reviews, a rating collected before Google, a term
 * that is certain to appear. 09_AI_Prompt_and_Generation_Spec.md, D-009/AC-006 and D-025/AC-010
 * forbid all three, and none of them is caught by the lint rule, which only guards AC-025's
 * submission claim. These assertions fail on the edit rather than in production.
 */

const STRINGS = Object.entries(copy).filter(
  (entry): entry is [string, string] => typeof entry[1] === 'string',
);

describe('AI screen copy', () => {
  it('exports only strings, so nothing escapes the checks below', () => {
    expect(STRINGS).toHaveLength(Object.keys(copy).length);
    expect(STRINGS.length).toBeGreaterThan(0);
  });

  /** D-009 and AC-006: no star rating anywhere before Google, so none may be offered or implied. */
  it('never offers a rating, a positive-only mode or a guarantee', () => {
    const forbidden = [
      /\b5[\s-]?star\b/i,
      /\bfive[\s-]?star\b/i,
      /positive only/i,
      /only positive/i,
      /\bsuppress/i,
      /\bguarantee/i,
      /\bmore positive reviews\b/i,
      /\bhigher rating\b/i,
    ];

    for (const [name, value] of STRINGS) {
      for (const pattern of forbidden) {
        expect(pattern.test(value), `${name} must not match ${String(pattern)}`).toBe(false);
      }
    }
  });

  /**
   * D-025 / AC-010. The helper text is quoted from the spec, and the clause that carries the
   * decision is the one saying the terms may not appear. Losing it would leave a screen that reads
   * as though merchant terms were guaranteed wording.
   */
  it('keeps the clause that makes context terms hints rather than requirements', () => {
    expect(copy.CONTEXT_HELPER).toContain('context hints');
    expect(copy.CONTEXT_HELPER).toContain('may not appear in every review');
  });

  /** AI-02-03. The reassurance is the whole reason an owner is willing to switch modes. */
  it('states that switching modes leaves QR codes alone', () => {
    expect(copy.QR_UNAFFECTED_NOTE).toMatch(/does not change your QR codes/);
  });

  /** AI-01-01: the preview consumes no quota, and the owner is told so before pressing it. */
  it('states that a preview costs no free generations', () => {
    expect(copy.PREVIEW_FREE_NOTE).toMatch(/free/i);
    expect(copy.PREVIEW_FREE_NOTE).toMatch(/never use/i);
  });

  /** A mode shifts emphasis only (09_AI_Prompt_and_Generation_Spec.md, "Review modes"). */
  it('describes a mode as emphasis and denies it is sentiment', () => {
    expect(copy.MODE_EMPHASIS_NOTE).toMatch(/never makes a draft more positive/);
    expect(copy.MODE_EMPHASIS_NOTE).toMatch(/never asks anyone for a rating/);
  });
});

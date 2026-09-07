import { describe, expect, it } from 'vitest';
import {
  CHECK_FAILED_MESSAGE,
  SAVE_FAILED_MESSAGE,
  claimCheck,
  claimSave,
  createRequestSlot,
  decideReviewLinkAction,
  invalidate,
  ownsSlot,
  ownsVerdict,
  readFailure,
  readUrl,
  settle,
  shouldCheckOnBlur,
} from '../review-link';

/**
 * ONB-02 — the review destination screen's save/no-save decisions and its request ordering.
 *
 * These are the parts that fail silently. A needless PUT bumps `businesses.config_version` and
 * invalidates the cached public configuration (AC-017) with nothing to show for it; a mis-ordered
 * response leaves the merchant looking at a verdict for a link they have already replaced, or at a
 * spinner that never stops. None of it is visible in a screenshot, so it is pinned here.
 */

const STORED = 'https://g.page/r/CdEfGhIjKl/review';

describe('what Continue and Save & exit do', () => {
  it('refuses an empty field on Continue but lets Save & exit leave', () => {
    // Not a skip: /onboarding resumes here and publish still refuses. Blocking the exit would
    // strand a merchant who is leaving in order to go and find the link.
    expect(decideReviewLinkAction('continue', '', null)).toBe('require-value');
    expect(decideReviewLinkAction('save-and-exit', '', null)).toBe('advance');
  });

  it('never writes when the value is unchanged since it was stored (AC-017)', () => {
    expect(decideReviewLinkAction('continue', STORED, STORED)).toBe('advance');
    expect(decideReviewLinkAction('save-and-exit', STORED, STORED)).toBe('advance');
  });

  it('also refuses an emptied field on Continue when a link is already stored', () => {
    // Clearing the box does not clear the destination, and Continue must not pretend it did.
    expect(decideReviewLinkAction('continue', '', STORED)).toBe('require-value');
  });

  it('saves a first link and any change to a stored one', () => {
    expect(decideReviewLinkAction('continue', STORED, null)).toBe('save');
    expect(decideReviewLinkAction('continue', `${STORED}?x=1`, STORED)).toBe('save');
    expect(decideReviewLinkAction('save-and-exit', `${STORED}?x=1`, STORED)).toBe('save');
  });

  it('treats a case difference as a change, because the server normalizes, not the browser', () => {
    expect(decideReviewLinkAction('continue', STORED.toUpperCase(), STORED)).toBe('save');
  });
});

describe('asking the server on blur', () => {
  const base = { trimmed: STORED, isSaved: false, hasVerdict: false, hasError: false };

  it('asks once there is something new to say about the value', () => {
    expect(shouldCheckOnBlur(base)).toBe(true);
  });

  it('says nothing about an empty field, the stored value, or a value already answered', () => {
    expect(shouldCheckOnBlur({ ...base, trimmed: '' })).toBe(false);
    expect(shouldCheckOnBlur({ ...base, isSaved: true })).toBe(false);
    expect(shouldCheckOnBlur({ ...base, hasVerdict: true })).toBe(false);
    expect(shouldCheckOnBlur({ ...base, hasError: true })).toBe(false);
  });
});

describe('the in-flight slot', () => {
  it('collapses the blur-then-click pair that pressing "Validate link" produces', () => {
    const slot = createRequestSlot();

    // Pressing the button blurs the input first, so the same value arrives twice.
    expect(claimCheck(slot, STORED)).toBe(1);
    expect(claimCheck(slot, STORED)).toBeNull();
  });

  it('lets Validate re-run once the previous answer has been applied', () => {
    const slot = createRequestSlot();
    const first = claimCheck(slot, STORED);
    expect(first).not.toBeNull();
    settle(slot, 1);

    expect(claimCheck(slot, STORED)).toBe(2);
  });

  it('keeps a stale answer from stopping the spinner of the request that replaced it', () => {
    // The reachable sequence: blur checks X, the merchant edits (invalidating it), Enter checks Y,
    // and only then does X come back. X must be discarded *and* must leave the busy state alone —
    // clearing it would stop the Validate spinner and lift the buttons while Y is still running.
    const slot = createRequestSlot();
    const stale = claimCheck(slot, 'https://g.page/r/first/review');
    invalidate(slot);
    const fresh = claimCheck(slot, 'https://g.page/r/second/review');

    expect(stale).toBe(1);
    expect(fresh).toBe(2);
    expect(ownsVerdict(slot, 1, 'https://g.page/r/first/review')).toBe(false);
    expect(ownsSlot(slot, 1)).toBe(false);

    settle(slot, 1);
    expect(slot.value).toBe('https://g.page/r/second/review');
    expect(ownsVerdict(slot, 2, 'https://g.page/r/second/review')).toBe(true);
    expect(ownsSlot(slot, 2)).toBe(true);
  });

  it('still releases the spinner for a check whose value was edited away', () => {
    // The other half of the same rule. Keying the release on the value instead of the ticket would
    // strand this request's spinner: nothing is left in flight, and nothing would ever clear it.
    const slot = createRequestSlot();
    const ticket = claimCheck(slot, STORED);
    invalidate(slot);

    expect(ticket).not.toBeNull();
    expect(ownsVerdict(slot, 1, STORED)).toBe(false);
    expect(ownsSlot(slot, 1)).toBe(true);
  });

  it('refuses a check while the PUT is in flight, and resumes once it settles', () => {
    // Enter and blur both still reach the check while a save runs (the Validate button is disabled,
    // the input is not). A check settling mid-save would clear the shell's "Saving" state.
    const slot = createRequestSlot();
    const save = claimSave(slot, STORED);

    expect(save).toBe(1);
    expect(claimCheck(slot, 'https://g.page/r/other/review')).toBeNull();

    settle(slot, save);
    expect(slot.saving).toBe(false);
    expect(claimCheck(slot, 'https://g.page/r/other/review')).toBe(2);
  });

  it('gives a save the slot even when a check for the same value is still open', () => {
    const slot = createRequestSlot();
    const check = claimCheck(slot, STORED);
    const save = claimSave(slot, STORED);

    expect(check).toBe(1);
    expect(save).toBe(2);

    // The superseded check may neither display its verdict nor release the save's busy state.
    expect(ownsVerdict(slot, 1, STORED)).toBe(false);
    expect(ownsSlot(slot, 1)).toBe(false);
    settle(slot, 1);
    expect(slot.saving).toBe(true);

    // The save still owns the slot, so it can write the normalized URL back into the box.
    expect(ownsVerdict(slot, save, STORED)).toBe(true);
  });
});

describe('unpacking the API envelope', () => {
  it('shows the specific rejection message the API returned, with its fields', () => {
    const failure = readFailure({
      error: {
        code: 'REVIEW_DESTINATION_INVALID',
        message: 'That is not a Google link. Use your Google review link or Maps short link.',
        details: { fields: ['url'] },
      },
    });

    expect(failure.code).toBe('REVIEW_DESTINATION_INVALID');
    expect(failure.message).toBe(
      'That is not a Google link. Use your Google review link or Maps short link.',
    );
    expect(failure.fields).toEqual(['url']);
  });

  it('falls back for a body that is not the error envelope at all', () => {
    // What a proxy's 502 page or a 204 becomes after readJsonBody: an empty object.
    for (const payload of [{}, { error: null }, { error: 'boom' }]) {
      const failure = readFailure(payload);
      expect(failure.code).toBe('INTERNAL_ERROR');
      expect(failure.message).toBe(SAVE_FAILED_MESSAGE);
      expect(failure.fields).toEqual([]);
    }
  });

  it('never shows a non-string message and never passes through non-string fields', () => {
    const failure = readFailure({
      error: { code: 'RATE_LIMITED', message: { nested: true }, details: { fields: ['url', 7] } },
    });

    expect(failure.code).toBe('RATE_LIMITED');
    expect(failure.message).toBe(SAVE_FAILED_MESSAGE);
    expect(failure.fields).toEqual(['url']);
  });

  it('reads the normalized URL back, and nothing else (ONB-02-03)', () => {
    expect(readUrl({ url: STORED })).toBe(STORED);
    expect(readUrl({ url: '' })).toBeNull();
    expect(readUrl({ url: null })).toBeNull();
    expect(readUrl({})).toBeNull();
  });
});

describe('what the merchant is told', () => {
  it('never claims a failed check means the link is wrong (the save re-validates)', () => {
    expect(CHECK_FAILED_MESSAGE).toContain('You can still press Continue');
  });
});

import { describe, expect, it } from 'vitest';
import {
  ONBOARDING_STEPS,
  canPublish,
  missingPublishRequirements,
  nextStep,
  previousStep,
  resumeStep,
  stepById,
  stepIndex,
  type OnboardingProgress,
} from '../steps';

function progress(over: Partial<OnboardingProgress> = {}): OnboardingProgress {
  return {
    status: 'DRAFT',
    hasBusinessDetails: false,
    hasReviewLink: false,
    hasContactLinks: false,
    hasAiContext: false,
    ...over,
  };
}

describe('step order', () => {
  it('matches the routes the screen spec names', () => {
    expect(ONBOARDING_STEPS.map((s) => s.path)).toEqual([
      '/onboarding/business',
      '/onboarding/review-link',
      '/onboarding/links',
      '/onboarding/ai',
      '/onboarding/finish',
    ]);
  });

  it('has no next after the last step and no previous before the first', () => {
    expect(nextStep('finish')).toBeNull();
    expect(previousStep('business')).toBeNull();
    expect(nextStep('business')?.id).toBe('review-link');
    expect(previousStep('finish')?.id).toBe('ai');
  });

  it('throws on an unknown id rather than returning undefined', () => {
    // @ts-expect-error deliberately outside the union — the guard is for runtime callers.
    expect(() => stepById('nope')).toThrow();
  });

  it('indexes every step', () => {
    for (const [i, step] of ONBOARDING_STEPS.entries()) {
      expect(stepIndex(step.id)).toBe(i);
    }
  });
});

describe('publish requirements', () => {
  it('needs business details and a review link, and nothing else', () => {
    expect(canPublish(progress())).toBe(false);
    expect(canPublish(progress({ hasBusinessDetails: true }))).toBe(false);
    expect(canPublish(progress({ hasReviewLink: true }))).toBe(false);
    expect(canPublish(progress({ hasBusinessDetails: true, hasReviewLink: true }))).toBe(true);
  });

  /** ONB-03 ships a "Skip optional" button and ONB-04's preview is a convenience. */
  it('does not require the optional steps', () => {
    const ready = progress({ hasBusinessDetails: true, hasReviewLink: true });
    expect(canPublish(ready)).toBe(true);
    expect(canPublish({ ...ready, hasContactLinks: false, hasAiContext: false })).toBe(true);
  });

  it('lists what is outstanding in wizard order', () => {
    expect(missingPublishRequirements(progress()).map((s) => s.id)).toEqual([
      'business',
      'review-link',
    ]);
    expect(
      missingPublishRequirements(progress({ hasBusinessDetails: true })).map((s) => s.id),
    ).toEqual(['review-link']);
    expect(
      missingPublishRequirements(progress({ hasBusinessDetails: true, hasReviewLink: true })),
    ).toEqual([]);
  });
});

describe('resumeStep', () => {
  it('starts a fresh tenant at the first step', () => {
    expect(resumeStep(progress()).id).toBe('business');
  });

  it('advances to the review link once details exist', () => {
    expect(resumeStep(progress({ hasBusinessDetails: true })).id).toBe('review-link');
  });

  /**
   * The regression this suite exists for.
   *
   * An earlier version walked every step and returned the first with no stored row. ONB-03's
   * "Skip optional" writes nothing, so hasContactLinks stayed false forever and the resume link
   * sent the owner back to a step publish does not even require — on every single visit.
   */
  it('does not send a skipped optional step back to the owner', () => {
    const skipped = progress({
      hasBusinessDetails: true,
      hasReviewLink: true,
      hasContactLinks: false,
      hasAiContext: false,
    });
    expect(resumeStep(skipped).id).toBe('finish');
  });

  it('sends a published tenant to the final step, not back through setup', () => {
    expect(resumeStep(progress({ status: 'ACTIVE' })).id).toBe('finish');
  });

  /**
   * A suspended tenant HAS published. Walking it back through setup would be wrong, and the
   * final step is where the paused state is explained.
   */
  it.each(['SUSPENDED', 'CLOSED'] as const)('sends a %s tenant to the final step', (status) => {
    expect(resumeStep(progress({ status })).id).toBe('finish');
  });

  it('never returns a step publish does not require while details are missing', () => {
    for (const contact of [true, false]) {
      for (const ai of [true, false]) {
        const p = progress({ hasContactLinks: contact, hasAiContext: ai });
        expect(resumeStep(p).id).toBe('business');
      }
    }
  });
});

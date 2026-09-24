import { describe, expect, it } from 'vitest';
import { ONBOARDING_STEPS, resumeStep, type OnboardingProgress } from '../../onboarding/steps';
import { describeSetupProgress } from '../setup-progress';

function progress(overrides: Partial<OnboardingProgress> = {}): OnboardingProgress {
  return {
    status: 'DRAFT',
    hasBusinessDetails: false,
    hasReviewLink: false,
    hasContactLinks: false,
    hasAiContext: false,
    ...overrides,
  };
}

describe('dashboard setup progress', () => {
  it('shows zero of five for a new draft and does not mistake DRAFT for publication', () => {
    const summary = describeSetupProgress(progress());
    expect(summary.doneCount).toBe(0);
    expect(summary.totalCount).toBe(5);
    expect(summary.steps.map((step) => step.done)).toEqual([false, false, false, false, false]);
    expect(summary.steps.map((step) => step.id)).toEqual(ONBOARDING_STEPS.map((step) => step.id));
  });

  it('counts both optional steps when completed, with publish still outstanding', () => {
    const summary = describeSetupProgress(
      progress({
        hasBusinessDetails: true,
        hasReviewLink: true,
        hasContactLinks: true,
        hasAiContext: true,
      }),
    );
    expect(summary.doneCount).toBe(4);
    expect(summary.steps.find((step) => step.id === 'finish')?.done).toBe(false);
  });

  it('labels skipped optional steps honestly without making them block publication', () => {
    const current = progress({ hasBusinessDetails: true, hasReviewLink: true });
    const summary = describeSetupProgress(current);
    expect(summary.doneCount).toBe(2);
    expect(summary.steps.filter((step) => step.optional).map((step) => step.id)).toEqual([
      'links',
      'ai',
    ]);
    expect(summary.steps.filter((step) => step.optional).every((step) => !step.done)).toBe(true);
    expect(resumeStep(current).id).toBe('finish');
  });

  it.each(['ACTIVE', 'SUSPENDED', 'CLOSED'] as const)(
    'recognises prior publication for %s without calling optional steps complete',
    (status) => {
      const summary = describeSetupProgress(progress({ status }));
      expect(summary.steps.find((step) => step.id === 'finish')?.done).toBe(true);
      expect(summary.doneCount).toBe(1);
    },
  );

  it('keeps the count equal to visible completed rows for every valid combination', () => {
    for (const status of ['DRAFT', 'ACTIVE', 'SUSPENDED', 'CLOSED'] as const) {
      for (let mask = 0; mask < 16; mask += 1) {
        const current = progress({
          status,
          hasBusinessDetails: Boolean(mask & 1),
          hasReviewLink: Boolean(mask & 2),
          hasContactLinks: Boolean(mask & 4),
          hasAiContext: Boolean(mask & 8),
        });
        const before = { ...current };
        const summary = describeSetupProgress(current);
        expect(summary.doneCount).toBe(summary.steps.filter((step) => step.done).length);
        expect(summary.steps.map((step) => step.done)).toEqual([
          current.hasBusinessDetails,
          current.hasReviewLink,
          current.hasContactLinks,
          current.hasAiContext,
          status !== 'DRAFT',
        ]);
        expect(summary.totalCount).toBe(ONBOARDING_STEPS.length);
        expect(current).toEqual(before);
      }
    }
  });
});

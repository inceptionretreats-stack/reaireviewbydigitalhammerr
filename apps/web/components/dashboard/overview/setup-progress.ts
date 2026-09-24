import {
  ONBOARDING_STEPS,
  type OnboardingProgress,
  type OnboardingStepId,
} from '@/lib/onboarding/steps';

/** Every displayed row and the total use the same actual completion state. */
export function describeSetupProgress(progress: OnboardingProgress) {
  const completed: Record<OnboardingStepId, boolean> = {
    business: progress.hasBusinessDetails,
    'review-link': progress.hasReviewLink,
    links: progress.hasContactLinks,
    ai: progress.hasAiContext,
    // A non-empty status such as DRAFT is not proof that publishing happened.
    finish: progress.status !== 'DRAFT',
  };
  const steps = ONBOARDING_STEPS.map((step) => ({
    ...step,
    done: completed[step.id],
    optional: step.id === 'links' || step.id === 'ai',
  }));

  return {
    steps,
    doneCount: steps.filter((step) => step.done).length,
    totalCount: steps.length,
  };
}

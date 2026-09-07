/**
 * The onboarding wizard's step contract (ONB-01 through ONB-05).
 *
 * Single source of truth for order, routes and titles, so the progress indicator, the
 * next/back navigation and the resume logic cannot disagree about what step three is.
 *
 * Paths match 03_Screen_Field_Button_Spec.md exactly — /onboarding/business,
 * /onboarding/review-link, /onboarding/links, /onboarding/ai, /onboarding/finish — because the
 * spec writes them as routes and support material will reference them.
 */

export const ONBOARDING_STEPS = [
  { id: 'business', screen: 'ONB-01', path: '/onboarding/business', title: 'Your business' },
  { id: 'review-link', screen: 'ONB-02', path: '/onboarding/review-link', title: 'Google link' },
  { id: 'links', screen: 'ONB-03', path: '/onboarding/links', title: 'Contact links' },
  { id: 'ai', screen: 'ONB-04', path: '/onboarding/ai', title: 'AI context' },
  { id: 'finish', screen: 'ONB-05', path: '/onboarding/finish', title: 'Publish' },
] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];
export type OnboardingStepId = OnboardingStep['id'];

export function stepById(id: OnboardingStepId): OnboardingStep {
  const step = ONBOARDING_STEPS.find((s) => s.id === id);
  if (!step) throw new Error(`Unknown onboarding step: ${id}`);
  return step;
}

export function stepIndex(id: OnboardingStepId): number {
  return ONBOARDING_STEPS.findIndex((s) => s.id === id);
}

export function nextStep(id: OnboardingStepId): OnboardingStep | null {
  return ONBOARDING_STEPS[stepIndex(id) + 1] ?? null;
}

export function previousStep(id: OnboardingStepId): OnboardingStep | null {
  const index = stepIndex(id);
  return index > 0 ? (ONBOARDING_STEPS[index - 1] ?? null) : null;
}

/**
 * What the wizard already knows about a tenant, used to decide where to resume.
 *
 * Read from the tenant itself rather than from a stored "current step", because every ONB screen
 * offers "Save & exit" and an owner may also close the tab, come back on another device, or edit
 * something out of order. Derived state cannot go stale; a stored cursor can.
 */
export interface OnboardingProgress {
  hasBusinessDetails: boolean;
  hasReviewLink: boolean;
  hasContactLinks: boolean;
  hasAiContext: boolean;
  isPublished: boolean;
}

/**
 * The first step still needing attention.
 *
 * Deliberately returns the earliest incomplete step rather than the furthest reached: the later
 * steps are cheap to pass through once done, and landing someone on step four when step two is
 * empty means they meet the publish blocker with no idea why.
 */
export function resumeStep(progress: OnboardingProgress): OnboardingStep {
  if (progress.isPublished) return stepById('finish');
  if (!progress.hasBusinessDetails) return stepById('business');
  if (!progress.hasReviewLink) return stepById('review-link');
  if (!progress.hasContactLinks) return stepById('links');
  if (!progress.hasAiContext) return stepById('ai');
  return stepById('finish');
}

/** Steps a person may jump to directly: everything up to and including the resume point. */
export function reachableSteps(progress: OnboardingProgress): OnboardingStepId[] {
  const limit = stepIndex(resumeStep(progress).id);
  return ONBOARDING_STEPS.filter((_, index) => index <= limit).map((s) => s.id);
}

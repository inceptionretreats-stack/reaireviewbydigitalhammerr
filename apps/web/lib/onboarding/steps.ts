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
  { id: 'ai', screen: 'ONB-04', path: '/onboarding/ai', title: 'Ai context' },
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

/** Mirrors businesses.status. Carried rather than flattened — see resumeStep. */
export type BusinessLifecycle = 'DRAFT' | 'ACTIVE' | 'SUSPENDED' | 'CLOSED';

/**
 * What the wizard already knows about a tenant, used to decide where to resume.
 *
 * Read from the tenant itself rather than from a stored "current step", because every ONB screen
 * offers "Save & exit" and an owner may also close the tab, come back on another device, or edit
 * something out of order. Derived state cannot go stale; a stored cursor can.
 */
export interface OnboardingProgress {
  status: BusinessLifecycle;
  hasBusinessDetails: boolean;
  hasReviewLink: boolean;
  hasContactLinks: boolean;
  hasAiContext: boolean;
}

/**
 * The first step still genuinely blocking progress.
 *
 * Only publish prerequisites are considered. An earlier version walked every step in order and
 * returned the first with no stored row, which meant anyone who used ONB-03's "Skip optional"
 * was sent back to that step on every single visit — no row is written, so the check never
 * cleared, and the wizard demanded a step that publish does not require.
 *
 * A tenant past DRAFT goes to the final step regardless: it is where both the live state and the
 * suspended state are explained, and re-walking setup for a published business is wrong.
 */
export function resumeStep(progress: OnboardingProgress): OnboardingStep {
  if (progress.status !== 'DRAFT') return stepById('finish');
  if (!progress.hasBusinessDetails) return stepById('business');
  if (!progress.hasReviewLink) return stepById('review-link');
  return stepById('finish');
}

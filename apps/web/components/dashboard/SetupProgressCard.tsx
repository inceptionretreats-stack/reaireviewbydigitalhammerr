import Link from 'next/link';
import { Card } from '@ai-review/ui';
import {
  ONBOARDING_STEPS,
  resumeStep,
  type OnboardingProgress,
  type OnboardingStepId,
} from '@/components/onboarding/steps';
import { PRIMARY_LINK } from './link-styles';

/**
 * The setup-progress card the design brief lists, for a tenant that has not published yet.
 *
 * Both the checklist and the destination come from the wizard's own contract in
 * `components/onboarding/steps.ts`, so the dashboard cannot disagree with the wizard about what
 * step three is or which step is next. `resumeStep` returns the earliest incomplete step rather
 * than the furthest reached, which is why the link is safe to follow from here: it lands on the
 * thing actually blocking publication, not wherever the owner happened to stop.
 *
 * Each row states its state as a shape and a word, never as a colour — the ticked and unticked
 * glyphs differ, and the state is spelled out for assistive technology.
 */

/**
 * Which progress flag each step is finished by.
 *
 * A total record over the step ids, so adding a sixth step to the wizard is a compile error here
 * rather than a silently unlisted row.
 */
const COMPLETED_BY: Record<OnboardingStepId, keyof OnboardingProgress> = {
  business: 'hasBusinessDetails',
  'review-link': 'hasReviewLink',
  links: 'hasContactLinks',
  ai: 'hasAiContext',
  finish: 'isPublished',
};

export function SetupProgressCard({ progress }: { progress: OnboardingProgress }) {
  const next = resumeStep(progress);
  const doneCount = ONBOARDING_STEPS.filter((step) => progress[COMPLETED_BY[step.id]]).length;

  // The last step publishes rather than collecting anything, so "Continue setup" would undersell
  // what the button does when it is the only thing left.
  const label = next.id === 'finish' ? 'Publish your page' : 'Continue setup';

  return (
    <Card
      title="Finish setting up"
      titleAs="h2"
      description="Your public page and QR codes start working the moment you publish."
      footer={
        <Link href={next.path} className={PRIMARY_LINK}>
          {label}
        </Link>
      }
    >
      <p className="mb-3 text-sm text-ink-muted">
        {doneCount} of {ONBOARDING_STEPS.length} steps done.
      </p>

      <ol className="m-0 flex list-none flex-col gap-2 p-0">
        {ONBOARDING_STEPS.map((step) => {
          const done = progress[COMPLETED_BY[step.id]];
          return (
            <li key={step.id} className="flex items-baseline gap-2 text-sm">
              <span aria-hidden="true" className={done ? 'text-success' : 'text-ink-muted'}>
                {done ? '✓' : '○'}
              </span>
              <span className={done ? 'text-ink-muted' : 'font-medium text-ink'}>{step.title}</span>
              <span className="sr-only">{done ? '— done' : '— still to do'}</span>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

import Link from 'next/link';
import { Card } from '@ai-review/ui';
import { resumeStep, type OnboardingProgress } from '@/lib/onboarding/steps';
import { PRIMARY_LINK } from '../link-styles';
import { describeSetupProgress } from './setup-progress';

/**
 * The setup-progress card the design brief lists, for a tenant that has not published yet.
 *
 * Both the checklist and the destination come from the wizard's own contract in
 * `lib/onboarding/steps.ts`, so the dashboard cannot disagree with the wizard about what
 * step three is or which step is next. `resumeStep` returns the earliest incomplete step rather
 * than the furthest reached, which is why the link is safe to follow from here: it lands on the
 * thing actually blocking publication, not wherever the owner happened to stop.
 *
 * Each row states its state as a shape and a word, never as a colour — the ticked and unticked
 * glyphs differ, and the state is spelled out for assistive technology.
 */

export function SetupProgressCard({ progress }: { progress: OnboardingProgress }) {
  const next = resumeStep(progress);
  const { steps, doneCount, totalCount } = describeSetupProgress(progress);

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
        {doneCount} of {totalCount} steps done. Contact links and Ai context are optional.
      </p>

      <ol className="vendor-setup-steps m-0 flex list-none flex-col gap-2 p-0">
        {steps.map((step) => {
          const { done } = step;
          return (
            <li key={step.id} className="flex items-baseline gap-2 text-sm">
              <span aria-hidden="true" className={done ? 'text-success' : 'text-ink-muted'}>
                {done ? '✓' : '○'}
              </span>
              <span className={done ? 'text-ink-muted' : 'font-medium text-ink'}>
                {step.title}
                {step.optional && <span className="ml-2 font-normal text-ink-muted">Optional</span>}
              </span>
              <span className="sr-only">
                {done ? '— done' : step.optional ? '— not added' : '— still to do'}
              </span>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

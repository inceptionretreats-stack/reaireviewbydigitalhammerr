'use client';

import { useRouter } from 'next/navigation';
import { useCallback, type ReactNode } from 'react';
import { Button } from '@ai-review/ui';
import styles from './VendorOnboarding.module.css';
import {
  ONBOARDING_STEPS,
  nextStep,
  previousStep,
  stepIndex,
  type OnboardingStepId,
} from './steps';

/**
 * Chrome shared by all five onboarding screens.
 *
 * Owns the progress indicator, the step heading and the footer navigation, so a screen supplies
 * only its own fields. Each screen decides what happens on Continue — most of them save first —
 * which is why `onContinue` returns a boolean rather than the shell doing the saving: the shell
 * has no idea what a given step needs to persist, and pretending otherwise would put five
 * different save calls in one component.
 */

export interface WizardShellProps {
  stepId: OnboardingStepId;
  /** Screen heading. The step title in the progress rail is deliberately shorter. */
  heading: string;
  description?: ReactNode;
  /**
   * Runs on Continue. Return true to advance, false to stay put — a screen returns false when
   * its own validation or its save failed, and will have shown the reason itself.
   */
  onContinue: () => Promise<boolean>;
  /** Persists whatever is entered without advancing. Absent on the final step. */
  onSaveAndExit?: (() => Promise<boolean>) | undefined;
  busy?: boolean;
  continueLabel?: string;
  children: ReactNode;
}

export function WizardShell({
  stepId,
  heading,
  description,
  onContinue,
  onSaveAndExit,
  busy = false,
  continueLabel,
  children,
}: WizardShellProps) {
  const router = useRouter();
  const index = stepIndex(stepId);
  const back = previousStep(stepId);
  const forward = nextStep(stepId);

  const handleContinue = useCallback(async () => {
    if (await onContinue()) {
      // The final step has no next: it publishes and routes to the dashboard itself.
      if (forward) router.push(forward.path);
    }
  }, [onContinue, forward, router]);

  const handleSaveAndExit = useCallback(async () => {
    if (!onSaveAndExit) return;
    if (await onSaveAndExit()) router.push('/app');
  }, [onSaveAndExit, router]);

  return (
    <div className={`onboarding-panel ${styles.panel}`}>
      <ProgressRail currentIndex={index} />

      <div className={styles.heading}>
        <p className={styles.stepCount}>
          Step {index + 1} of {ONBOARDING_STEPS.length}
        </p>
        <h1>{heading}</h1>
        {description ? <p>{description}</p> : null}
      </div>

      <div className={styles.fields}>{children}</div>

      <div className={styles.actions}>
        <div className={styles.secondaryActions}>
          {back ? (
            <Button
              type="button"
              variant="secondary"
              className={styles.backButton}
              disabled={busy}
              onClick={() => router.push(back.path)}
            >
              <Arrow direction="back" />
              Back
            </Button>
          ) : (
            <Button type="button" variant="secondary" className={styles.backButton} disabled>
              <Arrow direction="back" />
              Back
            </Button>
          )}

          {onSaveAndExit && (
            <Button
              type="button"
              variant="text"
              className={styles.saveButton}
              disabled={busy}
              onClick={() => void handleSaveAndExit()}
            >
              Save &amp; exit
            </Button>
          )}
        </div>

        <div className={styles.primaryAction}>
          <Button
            type="button"
            size="lg"
            fullWidth
            loading={busy}
            loadingLabel="Saving"
            onClick={() => void handleContinue()}
          >
            {continueLabel ?? 'Continue'}
            <Arrow />
          </Button>
        </div>
      </div>
    </div>
  );
}

function Arrow({ direction = 'forward' }: { direction?: 'back' | 'forward' }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={direction === 'back' ? 'M19 12H5m6-6-6 6 6 6' : 'M5 12h14m-6-6 6 6-6 6'} />
    </svg>
  );
}

/**
 * Progress rail.
 *
 * A list rather than a row of divs, and each step carries its name for assistive technology:
 * "step 2 of 5" read aloud without the step's name tells someone how far along they are and
 * nothing about where. `aria-current` marks the active one, so position is not conveyed by
 * colour alone (18_UI_UX brief).
 */
function ProgressRail({ currentIndex }: { currentIndex: number }) {
  return (
    <nav className={styles.progress} aria-label="Setup progress">
      <ol>
        {ONBOARDING_STEPS.map((step, index) => {
          const state = index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'todo';
          return (
            <li key={step.id} data-step-state={state}>
              <span
                aria-current={state === 'current' ? 'step' : undefined}
                className={styles.progressMarker}
              >
                {state === 'done' ? (
                  <svg
                    width="17"
                    height="17"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <path d="m5 12 4 4L19 6" />
                  </svg>
                ) : (
                  <span aria-hidden="true">{index + 1}</span>
                )}
                <span className="sr-only">
                  {step.title}
                  {state === 'done' ? ' — done' : state === 'current' ? ' — current step' : ''}
                </span>
              </span>
              <span className={styles.progressTitle} aria-hidden="true">
                {step.title}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

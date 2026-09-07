'use client';

import { useRouter } from 'next/navigation';
import { useCallback } from 'react';
import { Button, Card, InlineError } from '@ai-review/ui';
import { describeOtherSessions, describeSignedOutSessions } from './copy';
import { readCount, useSettingsSubmit } from './use-settings-submit';

/**
 * SET-01's "Log out other sessions", and the visible half of SET-01-02.
 *
 * The count is what makes the action honest. A button that answers a bare 204 leaves an owner
 * unable to tell a successful sweep from one that did nothing, and "revocation works" is precisely
 * the claim that needs evidence — so the resting state says how many other sessions are signed in,
 * and the confirmation says how many were ended, including when the answer is none.
 *
 * No password is asked for. This action grants nothing and its worst outcome is the caller signing
 * themselves out of another browser; it is also the thing somebody does in a hurry after realising
 * they left a session open on a shared machine. See the route handler for the full argument.
 */

export interface SessionsCardProps {
  /** Live sessions other than this one, counted on the server when the page rendered. */
  otherSessions: number;
}

export function SessionsCard({ otherSessions }: SessionsCardProps) {
  const router = useRouter();
  const { state, submit } = useSettingsSubmit('/api/v1/account/sessions/revoke-others', 'POST');

  const busy = state.status === 'submitting';
  const done = state.status === 'success';
  const signedOut = readCount(state, 'other_sessions_signed_out');

  // After a sweep the true count is zero, and the server prop catches up on the next render. Both
  // agree, so the resting line and the confirmation cannot contradict each other in between.
  const remaining = done ? 0 : otherSessions;

  const revoke = useCallback(async () => {
    const result = await submit({});
    // The session rows this screen counted have changed, and so has anything else on the page that
    // reads them.
    if (result.status === 'success') router.refresh();
  }, [router, submit]);

  return (
    <Card
      title="Where you are signed in"
      titleAs="h2"
      description="Signing out other sessions keeps this browser signed in and ends the rest."
    >
      <div className="flex flex-col gap-4">
        {state.status === 'error' && <InlineError>{state.failure.message}</InlineError>}

        {/*
          One polite region for both sentences, so the confirmation replaces the resting line
          instead of being announced beside a count that now disagrees with it.
        */}
        <p role="status" aria-live="polite" className="text-sm text-ink-muted">
          {done ? describeSignedOutSessions(signedOut) : describeOtherSessions(remaining)}
        </p>

        <div>
          <Button
            variant="secondary"
            loading={busy}
            loadingLabel="Signing out other sessions"
            // Never disabled, including after a sweep. Disabling removes the element from the tab
            // order, so the button the owner just pressed would drop keyboard focus to the top of
            // the document (AC-037, and the reason Button's `loading` does not disable either). The
            // endpoint is idempotent: pressing it again revokes nothing and says so.
            onClick={() => void revoke()}
          >
            Log out other sessions
          </Button>
        </div>
      </div>
    </Card>
  );
}

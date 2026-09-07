'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { Button, InlineError } from '@ai-review/ui';

/**
 * Sign out.
 *
 * A POST, not a link: `POST /api/v1/auth/logout` revokes the session row as well as clearing the
 * cookie, and its CSRF check refuses a request without a matching `Origin` — which a same-origin
 * `fetch` sends and a cross-site form does not. A GET link would also mean any prefetcher or
 * image loader could sign the owner out.
 *
 * `router.replace` rather than `push`, so Back cannot return to a dashboard rendered for a session
 * that no longer exists, and `refresh` after it because the client Router Cache still holds the
 * authenticated render of this page.
 *
 * The endpoint is idempotent and answers 204 whether or not a session was found, so the only
 * failure worth reporting is not reaching it at all. Sitting on that silently would leave the
 * owner believing they had signed out of a shared machine.
 */
export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const signOut = useCallback(async () => {
    setBusy(true);
    setFailed(false);

    try {
      const response = await fetch('/api/v1/auth/logout', { method: 'POST' });
      if (!response.ok) {
        setFailed(true);
        setBusy(false);
        return;
      }
    } catch {
      setFailed(true);
      setBusy(false);
      return;
    }

    router.replace('/login');
    router.refresh();
  }, [router]);

  return (
    <div className="flex flex-col items-start gap-1.5 lg:items-end">
      <Button
        variant="secondary"
        loading={busy}
        loadingLabel="Signing you out"
        onClick={() => void signOut()}
      >
        Sign out
      </Button>
      {failed && (
        <InlineError>Could not sign you out. Check your connection and try again.</InlineError>
      )}
    </div>
  );
}

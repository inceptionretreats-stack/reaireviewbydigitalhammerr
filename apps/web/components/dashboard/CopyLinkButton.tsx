'use client';

import { useCallback, useState } from 'react';
import { Button } from '@ai-review/ui';

/**
 * Copies the tenant's public address to the clipboard.
 *
 * The result is reported in a live region that is present from first render rather than one that
 * appears with the message: a region added to the DOM at the same moment as its content is
 * frequently not announced at all, which would leave a screen reader user with no confirmation
 * that anything happened.
 *
 * The confirmation is deliberately not cleared on a timer. A message that vanishes after two
 * seconds is one a slower reader never sees, and there is nothing stale about "Link copied" —
 * it is still true a minute later.
 *
 * `navigator.clipboard` is absent in an insecure context and can be refused by permission policy,
 * so the failure branch says what to do instead rather than pretending the copy worked.
 */

export interface CopyLinkButtonProps {
  value: string;
  /** Distinguishes several copy controls on one screen for assistive technology. */
  what: string;
}

type CopyState = 'idle' | 'copied' | 'failed';

const MESSAGE: Record<CopyState, string> = {
  idle: '',
  copied: 'Copied.',
  failed: 'Your browser blocked copying. Select the address and copy it yourself.',
};

/**
 * Paired with the message so success and failure differ by more than red versus grey — the design
 * brief forbids conveying state by colour alone. `aria-hidden`, because the message says it.
 */
const GLYPH: Record<CopyState, string> = { idle: '', copied: '✓', failed: '⚠' };

export function CopyLinkButton({ value, what }: CopyLinkButtonProps) {
  const [state, setState] = useState<CopyState>('idle');

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setState('copied');
    } catch {
      setState('failed');
    }
  }, [value]);

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <Button variant="secondary" onClick={() => void copy()}>
        Copy<span className="sr-only"> {what}</span>
      </Button>
      <p
        role="status"
        className={
          state === 'failed'
            ? 'flex items-center gap-1.5 text-sm font-medium text-danger'
            : 'flex items-center gap-1.5 text-sm text-ink-muted'
        }
      >
        <span aria-hidden="true">{GLYPH[state]}</span>
        {MESSAGE[state]}
      </p>
    </div>
  );
}

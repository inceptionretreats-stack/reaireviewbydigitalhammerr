'use client';

import { useEffect, useRef } from 'react';

/**
 * REV-02 and REV-03: edit, regenerate, confirm, copy, continue.
 *
 * Two controls, in the order the customer needs them: another draft, or take this one. Copying
 * and opening the review platform are one action (AMENDMENT-022). A second tap that appears only
 * after the first left people holding copied text on a page that looked finished.
 *
 * That action is an anchor, not a button calling `window.open`. The clipboard write is started
 * synchronously inside the click, so it still holds the user activation, and the navigation is
 * the anchor's own default — which a browser never blocks. Nothing is awaited between the two.
 *
 * What happens when the clipboard is not there is decided before navigating, not after. On a
 * plain-HTTP address (a LAN dev server) `navigator.clipboard` does not exist at all, so the tap
 * is turned into the manual path instead: the draft is selected for the device's own Copy
 * command and the destination is offered as a plain link. A write that is *attempted* and then
 * refused — a permissions prompt declined on HTTPS — is reported the same way on this page,
 * which stays open behind the new tab. "Copied" is only ever shown after the write resolved.
 *
 * The confirmation checkbox stays, and still gates the whole thing. V1 asks the customer nothing,
 * so the model knows nothing about their actual experience — the draft is a suggestion until a
 * real person affirms it is true (ADR-008, AC-008). It is a tick rather than a tap, which is why
 * two buttons do not touch it.
 *
 * Note what the final control says and does not say. It opens the review page. It never reports
 * that a review was submitted, because the platform cannot observe that (D-028, AC-025).
 */

const MAX_REVIEW_CHARS = 1200;

export type CopyStatus = 'idle' | 'copied' | 'failed';

export interface DraftEditorProps {
  draft: string;
  confirmed: boolean;
  copyStatus: CopyStatus;
  platformLabel: string;
  reviewUrl: string | null;
  onChange: (value: string) => void;
  onConfirmChange: (confirmed: boolean) => void;
  onRegenerate: () => void;
  /**
   * Starts the clipboard write. Returns false when no write could even be attempted, so the
   * caller can keep the customer on this page rather than send them off with nothing to paste.
   */
  onCopy: () => boolean;
  onOpenGoogle: () => void;
}

export function DraftEditor(props: DraftEditorProps) {
  const { draft, confirmed, copyStatus, platformLabel, reviewUrl } = props;
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const tooLong = draft.length > MAX_REVIEW_CHARS;
  const canCopy = confirmed && draft.trim().length > 0 && !tooLong;

  useEffect(() => {
    if (copyStatus !== 'failed') return;

    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    editor.select();
    editor.setSelectionRange(0, editor.value.length);
  }, [copyStatus]);

  return (
    <div className="stack">
      <label className="muted" htmlFor="review-draft">
        Your review — edit anything you like
      </label>
      <textarea
        ref={editorRef}
        id="review-draft"
        value={draft}
        maxLength={MAX_REVIEW_CHARS + 200}
        onChange={(event) => props.onChange(event.target.value)}
      />
      <p className="muted" aria-live="polite">
        {draft.length} / {MAX_REVIEW_CHARS} characters
        {tooLong && ' — please shorten before copying'}
      </p>

      <div className="confirm">
        <input
          id="genuine-experience"
          type="checkbox"
          checked={confirmed}
          onChange={(event) => props.onConfirmChange(event.target.checked)}
        />
        <label htmlFor="genuine-experience">
          I confirm this draft reflects my genuine experience.
        </label>
      </div>

      <button type="button" className="btn btn-secondary" onClick={props.onRegenerate}>
        New review
      </button>

      {reviewUrl ? (
        canCopy ? (
          <a
            className="btn btn-primary"
            href={reviewUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(event) => {
              if (!props.onCopy()) {
                // No clipboard to write to. Sending them to the platform now would be sending
                // them with nothing to paste; the manual path renders below instead.
                event.preventDefault();
                return;
              }
              // Recorded immediately before navigation, never after — the tab is leaving.
              props.onOpenGoogle();
            }}
          >
            Copy &amp; open {platformLabel}
          </a>
        ) : (
          /*
           * A disabled anchor is not a thing — `aria-disabled` still leaves it clickable, and
           * removing href turns it into something a keyboard cannot reach predictably. Rendering
           * a real disabled button instead keeps the gate honest and the control announced
           * correctly (AC-037).
           */
          <button type="button" className="btn btn-primary" disabled>
            Copy &amp; open {platformLabel}
          </button>
        )
      ) : (
        /* No destination configured, so there is nothing to open. Copying is still worth
           offering — the customer can paste it wherever they were going to write. */
        <button
          type="button"
          className="btn btn-primary"
          disabled={!canCopy}
          onClick={() => props.onCopy()}
        >
          {copyStatus === 'copied' ? 'Copy again' : 'Copy review'}
        </button>
      )}

      {!confirmed && <p className="muted">Tick the box above to copy your review and continue.</p>}

      {copyStatus === 'copied' && (
        <p className="muted" aria-live="polite">
          Copied. Paste it on {platformLabel} — you choose your own star rating there.
        </p>
      )}

      {copyStatus === 'failed' && (
        <>
          <p className="notice notice-error" role="alert">
            Your browser could not copy automatically. The full review is selected; use your
            device&apos;s Copy command, then open {platformLabel}.
          </p>
          {reviewUrl && (
            <a
              className="btn btn-secondary"
              href={reviewUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={props.onOpenGoogle}
            >
              Open {platformLabel}
            </a>
          )}
        </>
      )}
    </div>
  );
}

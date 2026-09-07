'use client';

/**
 * REV-02 and REV-03: edit, regenerate, confirm, copy, continue.
 *
 * Two controls, in the order the customer needs them: another draft, or take this one. Copying
 * and opening the review platform used to be two separate taps — the second appeared only after
 * the first — which left people holding copied text on a page that looked finished. They are one
 * action now.
 *
 * That action is an anchor, not a button with `window.open`. A popup opened after an awaited
 * clipboard write has lost its user activation and browsers block it; a real link navigating in
 * a new tab is never blocked. So the link is the control, and the clipboard write happens on the
 * way out.
 *
 * The confirmation checkbox stays, and still gates the whole thing. V1 asks the customer nothing,
 * so the model knows nothing about their actual experience — the draft is a suggestion until a
 * real person affirms it is true (ADR-008, AC-008). It is a tick rather than a tap, which is why
 * simplifying to two buttons does not touch it.
 *
 * Note what the final control says and does not say. It opens the review page. It never reports
 * that a review was submitted, because the platform cannot observe that (D-028, AC-025).
 */

const MAX_REVIEW_CHARS = 1200;

export interface DraftEditorProps {
  draft: string;
  confirmed: boolean;
  copied: boolean;
  platformLabel: string;
  reviewUrl: string | null;
  onChange: (value: string) => void;
  onConfirmChange: (confirmed: boolean) => void;
  onRegenerate: () => void;
  onCopy: () => void;
  onOpenGoogle: () => void;
}

export function DraftEditor(props: DraftEditorProps) {
  const { draft, confirmed, copied, platformLabel, reviewUrl } = props;
  const tooLong = draft.length > MAX_REVIEW_CHARS;
  const canCopy = confirmed && draft.trim().length > 0 && !tooLong;

  return (
    <div className="stack">
      <label className="muted" htmlFor="review-draft">
        Your review — edit anything you like
      </label>
      <textarea
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
            onClick={() => {
              // Both recorded immediately before navigation, never after — the tab is leaving.
              props.onCopy();
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
          onClick={props.onCopy}
        >
          {copied ? 'Copied' : 'Copy review'}
        </button>
      )}

      {!confirmed && <p className="muted">Tick the box above to copy your review and continue.</p>}

      {copied && (
        <p className="muted" aria-live="polite">
          Copied. Paste it on {platformLabel} to post it — you choose your own star rating there.
        </p>
      )}
    </div>
  );
}

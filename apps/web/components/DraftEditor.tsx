'use client';

/**
 * REV-02 and REV-03: edit, regenerate, confirm, copy, continue.
 *
 * The confirmation checkbox is the compliance gate the whole product rests on (ADR-008,
 * AC-008). V1 asks the customer nothing, so the model has no knowledge of their actual
 * experience — the draft is a suggestion until a real person affirms it is true. Copy stays
 * disabled until they do.
 *
 * Note what the final button says and does not say. It opens Google. It never reports that a
 * review was submitted, because the platform cannot observe that (D-028, AC-025).
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

      <button type="button" className="btn btn-secondary" onClick={props.onRegenerate}>
        Try a different draft
      </button>

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

      <button type="button" className="btn btn-primary" disabled={!canCopy} onClick={props.onCopy}>
        {copied ? 'Copied' : 'Copy Review'}
      </button>

      {copied && reviewUrl && (
        <>
          <a
            className="btn btn-primary"
            href={reviewUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={props.onOpenGoogle}
          >
            Continue to {platformLabel}
          </a>
          <p className="muted">
            Paste your review on {platformLabel} to post it. You choose your own star rating there.
          </p>
        </>
      )}
    </div>
  );
}

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import styles from './CustomerReview.module.css';
import { DraftEditor, type CopyStatus } from './DraftEditor';
import { ReviewFlowIcon } from './ReviewFlowIcon';

/**
 * The customer review flow: REV-01 (generate), REV-02 (edit/regenerate/confirm/copy) and
 * REV-03 (continue to Google).
 *
 * Several things are deliberately absent, and their absence is tested:
 *
 *  - No star rating anywhere before Google (D-009, AC-006). There is no sentiment branch
 *    either — with nothing to branch on there can be no rating gate, which is what keeps this
 *    on the right side of Google's fake-engagement policy.
 *  - No questionnaire (D-008). Generation starts on arrival — a scan is the tap.
 *  - Nothing claims the review was submitted (D-028, AC-025). The furthest this goes is
 *    opening Google, because that is the last thing the platform can actually observe.
 */

export interface PublicBusiness {
  slug: string | null;
  name: string;
  logoUrl: string | null;
  reviewUrl: string | null;
  reviewPlatformLabel: string;
}

export interface ReviewFlowProps {
  business: PublicBusiness;
  /** The printed QR code string, not the internal qr_codes.id. */
  qrCode?: string | null;
  /**
   * A draft this anonymous session already has, read server-side.
   *
   * Present on a refresh or a return visit, and the reason arriving does not spend a generation
   * every time. A free tenant has ten for the lifetime of the account, so without this a handful
   * of curious reloads would empty the allowance before anyone posted anything.
   */
  initialDraft?: { text: string; generationId: string } | null;
}

type Phase = 'ready' | 'generating' | 'draft';

interface FlowError {
  code: string;
  message: string;
}

export function ReviewFlow({ business, qrCode, initialDraft }: ReviewFlowProps) {
  const [phase, setPhase] = useState<Phase>(initialDraft ? 'draft' : 'generating');
  const [draft, setDraft] = useState(initialDraft?.text ?? '');
  const [generationId, setGenerationId] = useState<string | null>(
    initialDraft?.generationId ?? null,
  );
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<FlowError | null>(null);
  const [edited, setEdited] = useState(false);
  const [copyStatus, setCopyStatus] = useState<CopyStatus>('idle');

  const track = useCallback(
    (name: string, properties: Record<string, unknown> = {}) => {
      // AC-035: analytics must never block or delay the customer. Fire-and-forget with
      // keepalive so the beacon survives the page navigating away to Google.
      try {
        void fetch('/api/v1/public/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            properties,
            slug: business.slug ?? undefined,
            qr_code: qrCode ?? undefined,
          }),
          keepalive: true,
        }).catch(() => undefined);
      } catch {
        // An analytics failure is never surfaced to the customer.
      }
    },
    [qrCode, business.slug],
  );

  const generate = useCallback(
    async (isRegeneration: boolean) => {
      setError(null);
      setCopyStatus('idle');
      setPhase('generating');
      track(
        isRegeneration ? 'ai_regenerate_click' : 'ai_generate_click',
        isRegeneration && generationId ? { generation_id: generationId } : {},
      );

      try {
        const request = () =>
          fetch('/api/v1/public/review/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              slug: business.slug ?? undefined,
              qr_code: qrCode ?? undefined,
              previous_generation_id: isRegeneration ? generationId : undefined,
            }),
          });

        let response = await request();
        let payload: unknown = await response.json();

        // One quiet retry when the assistant reports itself unavailable. Measured on the free
        // Gemini tier: about two calls in sixty ran past the budget and every one of them
        // succeeded on the next try. A failed generation releases its quota reservation, so
        // this costs the business nothing; the customer just sees "Writing…" a moment longer.
        // Only 503 — a quota or plan refusal (402) is not going to change in a second.
        if (response.status === 503) {
          await new Promise((resolve) => setTimeout(resolve, 1500));
          response = await request();
          payload = await response.json();
        }

        if (!response.ok) {
          setError(extractError(payload));
          setPhase(draft ? 'draft' : 'ready');
          return;
        }

        const result = payload as { generation_id: string; review_text: string };
        setGenerationId(result.generation_id);
        setDraft(result.review_text);
        setEdited(false);
        // A regenerated draft is text the customer has not read yet, so an earlier
        // confirmation cannot carry over to it (ADR-008).
        setConfirmed(false);
        setPhase('draft');
      } catch {
        setError({
          code: 'AI_PROVIDER_UNAVAILABLE',
          message:
            'The writing assistant is unavailable right now. You can still write your own review.',
        });
        setPhase(draft ? 'draft' : 'ready');
      }
    },
    [draft, generationId, business.slug, qrCode, track],
  );

  /**
   * Starts the clipboard write and reports whether one was possible at all.
   *
   * Deliberately not async. The caller is an anchor's click handler and the navigation is that
   * click's default action; anything awaited here would run after the tab had already left.
   * The write itself is kicked off synchronously so it still holds the user activation, and its
   * outcome lands on this page, which stays open behind the new one.
   *
   * `navigator.clipboard` is absent outright on an insecure origin — a plain-HTTP LAN address —
   * so that case is known before anything happens and returns false. A write that is attempted
   * and then refused (a permissions prompt declined) is reported through the same 'failed'
   * state. Neither ever shows "Copied": the customer gets the draft selected for their device's
   * own Copy command instead.
   */
  const copyReview = useCallback((): boolean => {
    setError(null);

    if (!navigator.clipboard?.writeText) {
      setCopyStatus('failed');
      return false;
    }

    navigator.clipboard.writeText(draft).then(
      () => {
        track('review_copy', { generation_id: generationId, was_edited: edited });
        setCopyStatus('copied');
      },
      () => setCopyStatus('failed'),
    );
    return true;
  }, [draft, edited, generationId, track]);

  /**
   * Generate on arrival.
   *
   * A scan is already an intent to write a review, so making the customer tap "Generate" first
   * is a step that asks nothing and decides nothing. Skipped when the session already has a
   * draft — see initialDraft.
   *
   * The ref guards React 18's double-invoke in development, which would otherwise spend two
   * generations for one visit and make the free allowance half what it says.
   */
  const autoStarted = useRef(false);
  useEffect(() => {
    if (initialDraft || autoStarted.current) return;
    autoStarted.current = true;
    void generate(false);
  }, [initialDraft, generate]);

  const openGoogle = useCallback(() => {
    // REV-03-01: recorded immediately before navigation, never after — the page is leaving.
    track('google_open', { generation_id: generationId });
  }, [generationId, track]);

  return (
    <article className={styles.card} data-customer-review-flow>
      <header className={styles.identity}>
        {business.logoUrl ? (
          <img className={styles.logo} src={business.logoUrl} alt="" width={64} height={64} />
        ) : (
          <span className={styles.monogram} aria-hidden="true">
            {business.name
              .trim()
              .split(/\s+/)
              .slice(0, 2)
              .map((word) => Array.from(word)[0] ?? '')
              .join('')
              .toUpperCase() || '•'}
          </span>
        )}
        <h1 className={styles.businessName}>{business.name}</h1>
      </header>

      <div className={styles.flowBody}>
        {error && (
          <p className={styles.errorNotice} role="alert">
            {error.message}
          </p>
        )}

        {phase === 'generating' && (
          <div className={styles.loadingState} aria-live="polite" aria-busy="true">
            <ReviewFlowIcon name="spinner" className={styles.spinner} />
            <p className={styles.loadingTitle}>Writing your review…</p>
          </div>
        )}

        {/*
        'ready' is now only reachable by failing before a first draft exists. AC-036 requires the
        direct route to stay open when the assistant is down, so this offers writing it by hand
        rather than a Generate button that has just been shown not to work.
      */}
        {phase === 'ready' && (
          <p className={styles.readyState}>
            You can still write your own review — the link below opens{' '}
            {business.reviewPlatformLabel}.
          </p>
        )}

        {phase === 'draft' && (
          <DraftEditor
            draft={draft}
            confirmed={confirmed}
            copyStatus={copyStatus}
            platformLabel={business.reviewPlatformLabel}
            reviewUrl={business.reviewUrl}
            onChange={(value) => {
              setDraft(value);
              setCopyStatus('idle');
              setError(null);
              if (!edited) {
                setEdited(true);
                track('review_edit', { generation_id: generationId });
              }
            }}
            onConfirmChange={(next) => {
              setConfirmed(next);
              if (!next) {
                setCopyStatus('idle');
                setError(null);
              }
              if (next) track('experience_confirmed', { generation_id: generationId });
            }}
            onRegenerate={() => void generate(true)}
            onCopy={copyReview}
            onOpenGoogle={openGoogle}
          />
        )}

        {/*
        No private_feedback_open here. The feedback page emits it on render, which is what the
        taxonomy means by "Private feedback form opened" — emitting on the click as well would
        double-count every visitor who arrives from this flow, and inflate the denominator that
        private_feedback_submit is measured against.
      */}
        {/*
        Omitted rather than linked when there is no slug: the feedback page lives at
        /{slug}/feedback and there is nowhere to send anyone without one. A dead link that looks
        alive is worse than an absent one — this is the visitor's only private route, so it must
        either work or not be offered.
      */}
        {business.slug !== null && (
          <a className={styles.feedbackLink} href={`/${business.slug}/feedback`}>
            <ReviewFlowIcon name="message" />
            <span>Send private feedback instead</span>
          </a>
        )}

        {/*
        AC-036: when the assistant is unavailable the direct review link must still work. It
        renders from the same configured destination, so it cannot drift from the flow above.
      */}
        {/* Only when there is no draft to copy. The draft path reveals its destination after a
          successful copy or after presenting the explicit manual-copy fallback. */}
        {phase === 'ready' && business.reviewUrl && (
          <a
            className={styles.secondaryButton}
            href={business.reviewUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={openGoogle}
          >
            <span className={styles.buttonContent}>
              Write your own review on {business.reviewPlatformLabel}
              <ReviewFlowIcon name="arrow" />
            </span>
          </a>
        )}
      </div>

      <footer className={styles.footer}>
        <p className={styles.disclosure}>
          This draft is written with Ai assistance. Please edit it so it reflects your own
          experience before you post it.
        </p>
        <div className={styles.brandBars} aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </div>
        <p className={styles.credit}>By Digital Hammerr</p>
      </footer>
    </article>
  );
}

function extractError(payload: unknown): FlowError {
  const fallback = { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' };
  if (typeof payload !== 'object' || payload === null || !('error' in payload)) return fallback;

  const error = (payload as { error: { code?: string; message?: string } }).error;
  return { code: error.code ?? fallback.code, message: error.message ?? fallback.message };
}

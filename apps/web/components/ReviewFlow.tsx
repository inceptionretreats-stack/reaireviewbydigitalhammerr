'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { DraftEditor } from './DraftEditor';

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

type Phase = 'ready' | 'generating' | 'draft' | 'copied';

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
      setPhase('generating');
      track(isRegeneration ? 'ai_regenerate_click' : 'ai_generate_click');

      try {
        const response = await fetch('/api/v1/public/review/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            slug: business.slug ?? undefined,
            qr_code: qrCode ?? undefined,
            previous_generation_id: isRegeneration ? generationId : undefined,
          }),
        });

        const payload: unknown = await response.json();

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

  const copyReview = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(draft);
    } catch {
      // Clipboard permission can be denied; the textarea is still selectable, so not fatal.
    }
    track('review_copy', { generation_id: generationId, was_edited: edited });
    setPhase('copied');
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
    <div className="stack">
      <div className="identity">
        {business.logoUrl && <img src={business.logoUrl} alt="" width={72} height={72} />}
        <h1>{business.name}</h1>
      </div>

      {error && (
        <p className="notice notice-error" role="alert">
          {error.message}
        </p>
      )}

      {phase === 'generating' && (
        <p className="muted" aria-live="polite" aria-busy="true">
          Writing your review…
        </p>
      )}

      {/*
        'ready' is now only reachable by failing before a first draft exists. AC-036 requires the
        direct route to stay open when the assistant is down, so this offers writing it by hand
        rather than a Generate button that has just been shown not to work.
      */}
      {phase === 'ready' && (
        <p className="muted">
          You can still write your own review — the link below opens {business.reviewPlatformLabel}.
        </p>
      )}

      {(phase === 'draft' || phase === 'copied') && (
        <DraftEditor
          draft={draft}
          confirmed={confirmed}
          copied={phase === 'copied'}
          platformLabel={business.reviewPlatformLabel}
          reviewUrl={business.reviewUrl}
          onChange={(value) => {
            setDraft(value);
            if (!edited) {
              setEdited(true);
              track('review_edit', { generation_id: generationId });
            }
          }}
          onConfirmChange={(next) => {
            setConfirmed(next);
            if (next) track('experience_confirmed', { generation_id: generationId });
          }}
          onRegenerate={() => void generate(true)}
          onCopy={() => void copyReview()}
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
        <a className="btn btn-text" href={`/${business.slug}/feedback`}>
          Send private feedback instead
        </a>
      )}

      {/*
        AC-036: when the assistant is unavailable the direct review link must still work. It
        renders from the same configured destination, so it cannot drift from the flow above.
      */}
      {/* Only when there is no draft to copy: once there is, the Copy button opens
          {business.reviewPlatformLabel} itself and a second link to the same place is noise. */}
      {phase === 'ready' && business.reviewUrl && (
        <a
          className="btn btn-secondary"
          href={business.reviewUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={openGoogle}
        >
          Write your own review on {business.reviewPlatformLabel}
        </a>
      )}

      <p className="disclosure">
        This draft is written with AI assistance. Please edit it so it reflects your own experience
        before you post it.
      </p>
    </div>
  );
}

function extractError(payload: unknown): FlowError {
  const fallback = { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' };
  if (typeof payload !== 'object' || payload === null || !('error' in payload)) return fallback;

  const error = (payload as { error: { code?: string; message?: string } }).error;
  return { code: error.code ?? fallback.code, message: error.message ?? fallback.message };
}

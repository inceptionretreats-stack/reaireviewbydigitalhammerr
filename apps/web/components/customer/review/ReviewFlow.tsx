'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import styles from './CustomerReview.module.css';
import { DraftEditor, type CopyStatus } from './DraftEditor';
import { ReviewFlowIcon } from './ReviewFlowIcon';
import { ServicePicker } from './ServicePicker';
import { MAX_SELECTED_SERVICE_CHARACTERS } from '@/lib/customer/customer-services';

/**
 * The customer review flow: REV-01 (generate), REV-02 (edit/regenerate/confirm/copy) and
 * REV-03 (continue to Google).
 *
 * Several things are deliberately absent, and their absence is tested:
 *
 *  - No star rating anywhere before Google (D-009, AC-006). There is no sentiment branch
 *    either — with nothing to branch on there can be no rating gate, which is what keeps this
 *    on the right side of Google's fake-engagement policy.
 *  - Service selection is factual and optional to bypass via the direct review link. It never
 *    asks for a rating or controls who can leave public/private feedback.
 *  - Nothing claims the review was submitted (D-028, AC-025). The furthest this goes is
 *    opening Google, because that is the last thing the platform can actually observe.
 */

export interface PublicBusiness {
  slug: string | null;
  name: string;
  logoUrl: string | null;
  reviewUrl: string | null;
  reviewPlatformLabel: string;
  services?: string[];
}

export interface ReviewFlowProps {
  business: PublicBusiness;
  /** The printed QR code string, not the internal qr_codes.id. */
  qrCode?: string | null;
  /**
   * A draft this anonymous session already has, read server-side.
   *
   * Available behind an explicit Return to draft action on a refresh or return visit. It must
   * never skip the services screen, preselect services for a new visit, or spend another draft.
   */
  initialDraft?: { text: string; generationId: string } | null;
}

type Phase = 'choose' | 'generating' | 'draft';
const NO_SERVICES: string[] = [];

interface FlowError {
  code: string;
  message: string;
}

export function ReviewFlow({ business, qrCode, initialDraft }: ReviewFlowProps) {
  const services = business.services ?? NO_SERVICES;
  // A scan always starts with a fresh service choice. A saved draft is an optional recovery
  // action, not the entry screen — even for a returning anonymous session.
  const [phase, setPhase] = useState<Phase>('choose');
  const [selectedServices, setSelectedServices] = useState<string[]>([]);
  const [draftServices, setDraftServices] = useState<string[]>([]);
  const [draft, setDraft] = useState(initialDraft?.text ?? '');
  const [generationId, setGenerationId] = useState<string | null>(
    initialDraft?.generationId ?? null,
  );
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<FlowError | null>(null);
  const [edited, setEdited] = useState(false);
  const [copyStatus, setCopyStatus] = useState<CopyStatus>('idle');
  const [interactive, setInteractive] = useState(false);
  const inFlight = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const focusNextPhase = useRef(false);
  const selectionKey = `ai-review:services:v1:${business.slug ?? qrCode ?? ''}`;

  // Server-rendered buttons have no click handlers until hydration finishes. Show them as
  // temporarily disabled so an early tap on a slow phone cannot look accepted but do nothing.
  useEffect(() => setInteractive(true), []);

  useEffect(() => {
    if (!initialDraft) return;
    try {
      const saved = JSON.parse(sessionStorage.getItem(selectionKey) ?? 'null') as {
        generationId?: unknown;
        services?: unknown;
      } | null;
      if (saved?.generationId !== initialDraft.generationId || !Array.isArray(saved.services))
        return;
      const savedServices = saved.services;
      const valid = services.filter((service) => savedServices.includes(service));
      // Removed/renamed vendor services require a fresh choice, not a partial old selection.
      if (valid.length !== saved.services.length) return;
      // Keep these only for the saved draft. Do not check choices on the services entry screen.
      setDraftServices(valid);
    } catch {
      // Storage may be blocked. The saved draft is still usable; only reselection is needed.
    }
  }, [initialDraft, selectionKey, services]);

  useEffect(() => {
    if (!focusNextPhase.current || phase === 'generating') return;
    headingRef.current?.focus();
    focusNextPhase.current = false;
  }, [phase]);

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
      if (inFlight.current) return;
      if (services.length > 0 && selectedServices.length === 0) {
        focusNextPhase.current = true;
        setPhase('choose');
        return;
      }
      inFlight.current = true;
      focusNextPhase.current = true;
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
              selected_services: selectedServices,
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
          setPhase(isRegeneration && draft ? 'draft' : 'choose');
          return;
        }

        const result = payload as {
          generation_id: string;
          review_text: string;
          selected_services?: string[];
        };
        const usedServices = result.selected_services ?? selectedServices;
        setGenerationId(result.generation_id);
        setDraft(result.review_text);
        setDraftServices(usedServices);
        try {
          // Store only selection metadata, not the customer's review or confirmation.
          sessionStorage.setItem(
            selectionKey,
            JSON.stringify({
              generationId: result.generation_id,
              services: usedServices,
            }),
          );
        } catch {
          /* The flow also works without browser storage. */
        }
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
        setPhase(isRegeneration && draft ? 'draft' : 'choose');
      } finally {
        inFlight.current = false;
      }
    },
    [
      draft,
      generationId,
      business.slug,
      qrCode,
      track,
      services.length,
      selectedServices,
      selectionKey,
    ],
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

  const openGoogle = useCallback(() => {
    // REV-03-01: recorded immediately before navigation, never after — the page is leaving.
    track('google_open', { generation_id: generationId });
  }, [generationId, track]);

  const changeServices = () => {
    setSelectedServices(draftServices);
    setError(null);
    setCopyStatus('idle');
    focusNextPhase.current = true;
    setPhase('choose');
  };
  const activeStep = phase === 'choose' ? 0 : copyStatus === 'copied' ? 2 : 1;

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
        <div className={styles.identityText}>
          <h1 className={styles.businessName}>{business.name}</h1>
          <p className={styles.identityCaption}>Your experience. Your words.</p>
        </div>
      </header>

      <ol className={styles.progress} aria-label="Review progress">
        {[services.length ? 'Services' : 'Start', 'Your draft', 'Share'].map((label, index) => (
          <li
            key={label}
            data-state={
              index < activeStep ? 'complete' : index === activeStep ? 'current' : 'upcoming'
            }
            aria-current={index === activeStep ? 'step' : undefined}
          >
            <span className={styles.progressDot} aria-hidden="true">
              {index < activeStep && (
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="m4 10 4 4 8-8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </span>
            <span>{label}</span>
          </li>
        ))}
      </ol>

      <div className={styles.flowBody}>
        {phase !== 'generating' && (
          <div className={styles.introduction}>
            <h2 ref={headingRef} tabIndex={-1} className={styles.flowTitle}>
              {phase === 'draft'
                ? 'Make it your own'
                : services.length
                  ? 'What did you try?'
                  : 'Share your experience'}
            </h2>
            <p>
              {phase === 'draft'
                ? 'Read your draft and change anything you like.'
                : services.length
                  ? 'Select the services you used. You can choose more than one.'
                  : 'Start with an AI draft, then make it your own.'}
            </p>
          </div>
        )}
        {error && (
          <p className={styles.errorNotice} role="alert">
            {error.message}
          </p>
        )}

        {phase === 'generating' && (
          <div className={styles.loadingState} aria-live="polite" aria-busy="true">
            <ReviewFlowIcon name="spinner" className={styles.spinner} />
            <p className={styles.loadingTitle}>Writing your review…</p>
            <p className={styles.loadingText}>
              {selectedServices.length
                ? `Based on ${selectedServices.join(', ')}.`
                : 'Preparing a starting point for your own words.'}
            </p>
            <div className={styles.loadingLines} aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
          </div>
        )}

        {phase === 'choose' && (
          <>
            {services.length > 0 && (
              <ServicePicker
                services={services}
                selected={selectedServices}
                disabled={!interactive}
                onChange={(next) => {
                  setSelectedServices(next);
                  setError(null);
                }}
              />
            )}
            <div>
              <button
                type="button"
                className={styles.primaryButton}
                disabled={
                  !interactive ||
                  (services.length > 0 && selectedServices.length === 0) ||
                  selectedServices.join(', ').length > MAX_SELECTED_SERVICE_CHARACTERS
                }
                onClick={() => void generate(false)}
              >
                <span className={styles.buttonContent}>
                  {error ? 'Try again' : 'Create my draft'}
                  <ReviewFlowIcon name="arrow" />
                </span>
              </button>
              <p className={styles.helper}>You can edit every word before sharing.</p>
            </div>
            {draft && (
              <button
                className={styles.textButton}
                type="button"
                // Server-rendered and tappable before React hydrates, exactly like the primary
                // button above — but without this guard the first tap was swallowed in 5 of 6
                // runs. This is the only way back to a draft the customer was part-way through,
                // so a dead tap either loses them or sends them to "Create my draft", spending
                // another of the tenant's ten lifetime free drafts.
                disabled={!interactive}
                onClick={() => {
                  setSelectedServices(draftServices);
                  setError(null);
                  focusNextPhase.current = true;
                  setPhase('draft');
                }}
              >
                Return to draft
              </button>
            )}
          </>
        )}

        {phase === 'draft' && (
          <>
            {services.length > 0 && (
              <div className={styles.serviceSummary}>
                <span>
                  {draftServices.length
                    ? draftServices.join(' · ')
                    : 'Choose services for a new draft'}
                </span>
                <button type="button" onClick={changeServices}>
                  Change services
                </button>
              </div>
            )}
            <DraftEditor
              draft={draft}
              confirmed={confirmed}
              copyStatus={copyStatus}
              platformLabel={business.reviewPlatformLabel}
              reviewUrl={business.reviewUrl}
              onChange={(value) => {
                setDraft(value);
                setConfirmed(false);
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
              onRegenerate={() => {
                if (services.length && !draftServices.length) changeServices();
                else void generate(true);
              }}
              onCopy={copyReview}
              onOpenGoogle={openGoogle}
            />
          </>
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
        {phase === 'choose' && business.reviewUrl && (
          <a
            className={styles.directLink}
            href={business.reviewUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={openGoogle}
          >
            <span className={styles.buttonContent}>
              Write my own review
              <ReviewFlowIcon name="arrow" />
            </span>
          </a>
        )}
      </div>

      <footer className={styles.footer}>
        <p className={styles.disclosure}>AI helps with wording. You decide what to post.</p>
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

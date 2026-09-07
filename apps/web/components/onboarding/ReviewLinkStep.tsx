'use client';

import { useCallback, useRef, useState } from 'react';
import type { ReviewDestinationKind } from '@ai-review/core';
import { Badge, Button, Field, FOCUS_RING, Input } from '@ai-review/ui';
// The screen's decisions — what Continue writes, which blur asks the server, and which of two
// concurrent answers owns the screen — live in `./review-link` so they can be unit-tested without a
// DOM (apps/web has no DOM test environment). It carries the type-only import of `@ai-review/core`
// with the reason it has to stay type-only.
import {
  CHECK_FAILED_MESSAGE,
  REASONS_WORTH_INSTRUCTIONS,
  REQUIRED_MESSAGE,
  claimCheck,
  claimSave,
  createRequestSlot,
  decideReviewLinkAction,
  invalidate,
  ownsSlot,
  ownsVerdict,
  readFailure,
  readUrl,
  settle,
  shouldCheckOnBlur,
  type JsonResult,
  type ReviewLinkCheck,
  type ReviewLinkIntent,
} from './review-link';
import { WizardShell } from './WizardShell';

/**
 * ONB-02 — the Google review destination.
 *
 * The spec lists one field (Google review URL, required), three actions (Validate link, Continue,
 * How to find my Google review link) and four states (default, valid, invalid/unsupported, saved).
 *
 * This is the most consequential field in the product: it is where every customer is sent after
 * copying their draft, and no amount of traffic tells the platform apart from a merchant typo — a
 * wrong link fails silently, forever, on printed material. So the screen is deliberately unhurried:
 * an explicit check, the normalized URL shown before it is committed, and an invitation to open the
 * link once and confirm it lands on the right business.
 *
 * Five decisions worth stating.
 *
 * 1. Validation is server-side and the browser carries no copy of the rules. ONB-02-02 restricts
 *    the accepted hosts and `validateGoogleReviewUrl` in `@ai-review/core` is authoritative; the
 *    host set is also the part most likely to change, because Google has changed review-link
 *    formats repeatedly. A stale mirror in the browser would reject links the server accepts,
 *    which is the worst failure this screen has available to it. Fast feedback comes from asking
 *    the server on blur (the `checkUrl` action the page passes in), not from guessing locally.
 *
 * 2. "Validate link" does not save. Besides the spec listing `valid` and `saved` separately, every
 *    PUT bumps `businesses.config_version` to invalidate the cached public configuration (AC-017),
 *    so making validation a write would churn that cache on every check.
 *
 * 3. Continue does not validate and then save — it just saves. The PUT runs the same authoritative
 *    validator and returns a specific message per rejection reason, so a pre-flight check would be
 *    a second round trip for an answer the save already gives.
 *
 * 4. This step is not skippable. The publish route treats the review destination as its one
 *    genuinely non-negotiable prerequisite, so letting an empty field through only defers the same
 *    failure to the last screen, where it arrives with no clue which step caused it.
 *
 * 5. The two busy states are not one. Only the *save* is handed to `WizardShell`, because the shell
 *    turns `busy` into a loading Continue button whose clicks `Button` swallows (it deliberately
 *    does not set `disabled`, so focus is not dropped mid-task). Handing it the *checking* state
 *    ate the first Continue press outright: pressing the button blurs the input, the blur starts a
 *    check, and the click then arrives at an already-loading button — nothing saved, no advance,
 *    and an sr-only "Saving" announced for a validation that persists nothing. Checking belongs
 *    to the Validate button and to nothing else.
 *
 * `useFormSubmit` is not reused: it is POST-only and models one operation per screen, while this
 * screen has two (a check that does not persist, and an idempotent PUT). Its `SubmitFailure` shape
 * and envelope unpacking are reused so the error contract stays in one shape (23_API_Error_Codes).
 */

const ENDPOINT = '/api/v1/business/review-destination';

// Re-exported so the page keeps importing the Server Action's return type from the component it
// hands the action to.
export type { ReviewLinkCheck };

export interface ReviewLinkStepProps {
  /** The URL already stored for this business, or null on a first visit. */
  savedUrl: string | null;
  /**
   * Server-side validation that deliberately does not persist. A Server Action, so the
   * authoritative validator runs where it already lives instead of being reimplemented here.
   */
  checkUrl: (url: string) => Promise<ReviewLinkCheck>;
  /** Where the already-saved link lands, classified server-side so this stays a pure client. */
  savedUrlKind?: ReviewDestinationKind | null;
}

export function ReviewLinkStep({ savedUrl, checkUrl, savedUrlKind = null }: ReviewLinkStepProps) {
  const [value, setValue] = useState(savedUrl ?? '');
  const [storedUrl, setStoredUrl] = useState(savedUrl);
  const [valid, setValid] = useState<{
    url: string;
    host: string;
    kind: ReviewDestinationKind;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'checking' | 'saving' | null>(null);
  // Open by default for someone who has no link yet: on this step the instructions are the work,
  // not a footnote. A merchant returning to change a link they already have (AC-017) does not need
  // them in the way.
  const [helpOpen, setHelpOpen] = useState(savedUrl === null);

  /**
   * The one in-flight server round trip this screen allows itself. A ref rather than state because
   * every read of it is a decision made inside an already-running request, not a render.
   * `./review-link` documents what the two fields each answer.
   */
  const slot = useRef(createRequestSlot());

  const trimmed = value.trim();
  const isSaved = storedUrl !== null && trimmed === storedUrl;

  /**
   * Only ever a server-validated URL: the stored one, or one the validator just accepted. A raw
   * input value must never become an href — `javascript:` and friends are exactly what the scheme
   * and host checks exist to keep out of this field.
   */
  const testableUrl = isSaved ? storedUrl : (valid?.url ?? null);
  const testableKind = isSaved ? savedUrlKind : (valid?.kind ?? null);

  const clearVerdict = useCallback(() => {
    // Any edit invalidates what is displayed and any answer still in flight.
    invalidate(slot.current);
    setValid(null);
    setError(null);
  }, []);

  const runCheck = useCallback(
    async (candidate: string): Promise<void> => {
      if (candidate.length === 0) {
        setValid(null);
        setError(REQUIRED_MESSAGE);
        return;
      }

      // Refused for a duplicate blur-then-click pair, and while a save is in flight.
      const ticket = claimCheck(slot.current, candidate);
      if (ticket === null) return;
      setBusy('checking');

      try {
        const result = await checkUrl(candidate);
        if (!ownsVerdict(slot.current, ticket, candidate)) return;

        if (result.ok) {
          setValid({ url: result.url, host: result.host, kind: result.kind });
          setError(null);
        } else {
          setValid(null);
          setError(result.message);
          // The instructions are the fix for these two, so surface them instead of leaving the
          // merchant to guess that the disclosure is where the answer is.
          if (REASONS_WORTH_INSTRUCTIONS.includes(result.reason)) setHelpOpen(true);
        }
      } catch {
        if (!ownsVerdict(slot.current, ticket, candidate)) return;
        setValid(null);
        setError(CHECK_FAILED_MESSAGE);
      } finally {
        settle(slot.current, ticket);
        // Only the newest request may stop the spinner: a discarded stale answer clearing it would
        // re-enable the buttons while a newer request is still running.
        if (ownsSlot(slot.current, ticket)) setBusy(null);
      }
    },
    [checkUrl],
  );

  const save = useCallback(async (candidate: string): Promise<boolean> => {
    const ticket = claimSave(slot.current, candidate);
    setBusy('saving');

    try {
      const result = await sendJson(ENDPOINT, 'PUT', { url: candidate });

      if (!result.ok) {
        setValid(null);
        // The API returns a specific message per rejection reason (REVIEW_DESTINATION_INVALID);
        // displayed verbatim, because a generic "invalid link" hides which of four different
        // mistakes this actually was.
        setError(result.failure.message);
        if (result.failure.code === 'REVIEW_DESTINATION_INVALID') setHelpOpen(true);
        return false;
      }

      const saved = readUrl(result.payload) ?? candidate;
      setStoredUrl(saved);
      setValid(null);
      setError(null);

      // ONB-02-03 stores the URL normalized. Showing the stored form rather than the paste means
      // what is on screen is what customers will actually be sent to — but only if the box still
      // holds what we just saved. Typing during a save is rare and overwriting it would look like
      // the field fighting back; the save itself stands either way.
      if (ownsVerdict(slot.current, ticket, candidate)) setValue(saved);
      return true;
    } finally {
      settle(slot.current, ticket);
      if (ownsSlot(slot.current, ticket)) setBusy(null);
    }
  }, []);

  const runStep = useCallback(
    async (intent: ReviewLinkIntent): Promise<boolean> => {
      const action = decideReviewLinkAction(intent, trimmed, storedUrl);
      switch (action) {
        case 'require-value':
          setValid(null);
          setError(REQUIRED_MESSAGE);
          return false;
        case 'advance':
          return true;
        case 'save':
          return save(trimmed);
      }
    },
    [trimmed, storedUrl, save],
  );

  const handleContinue = useCallback(() => runStep('continue'), [runStep]);
  const handleSaveAndExit = useCallback(() => runStep('save-and-exit'), [runStep]);

  const normalizedDiffers = valid !== null && valid.url !== trimmed;

  return (
    <WizardShell
      stepId="review-link"
      heading="Where should customers leave their review?"
      description="Everyone who copies a review is sent to this link, so it is worth checking carefully. You can change it later without reprinting your QR code."
      onContinue={handleContinue}
      onSaveAndExit={handleSaveAndExit}
      // The save only, never the check — decision 5 above.
      busy={busy === 'saving'}
    >
      <div className="flex flex-col gap-4">
        <Field
          label="Google review link"
          required
          error={error}
          hint="Starts with https:// — usually https://g.page/r/… or https://maps.app.goo.gl/…"
        >
          {(control) => (
            <Input
              {...control}
              name="review_url"
              type="url"
              inputMode="url"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="https://"
              value={value}
              onChange={(event) => {
                setValue(event.target.value);
                clearVerdict();
              }}
              onBlur={() => {
                // Feedback the moment they leave the field, without a request per keystroke.
                // Skipped when there is nothing new to say about the current value.
                const ask = shouldCheckOnBlur({
                  trimmed,
                  isSaved,
                  hasVerdict: valid !== null,
                  hasError: error !== null,
                });
                if (ask) void runCheck(trimmed);
              }}
              onKeyDown={(event) => {
                // There is no <form> here, so Enter would otherwise do nothing at all. It checks
                // rather than continues: on this field a stray Enter should not commit a value the
                // merchant has not looked at yet.
                if (event.key === 'Enter') void runCheck(trimmed);
              }}
            />
          )}
        </Field>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            loading={busy === 'checking'}
            loadingLabel="Checking your link"
            disabled={busy === 'saving'}
            onClick={() => void runCheck(trimmed)}
          >
            Validate link
          </Button>
        </div>

        {/*
          Present on every render, with or without content: a live region inserted at the same
          moment as its text is announced unreliably. Errors are not routed through here — Field
          renders them in an InlineError, which is already role="alert".
        */}
        <div aria-live="polite" className="flex flex-col gap-2 text-sm">
          {isSaved && (
            <p className="flex flex-wrap items-center gap-2 text-ink">
              <Badge tone="success">Saved</Badge>
              <span>This is where customers will be sent.</span>
            </p>
          )}

          {valid !== null && !isSaved && (
            <p className="flex flex-wrap items-center gap-2 text-ink">
              <Badge tone="accent">Valid Google link</Badge>
              <span>Press Continue to save it.</span>
            </p>
          )}

          {normalizedDiffers && valid !== null && (
            <p className="text-ink-muted">
              Will be saved as <span className="break-all text-ink">{valid.url}</span> — tracking
              parameters are removed so the stored link stays stable.
            </p>
          )}
        </div>

        {/*
          A listing link is valid and accepted (ONB-02-02), and it is still the wrong one. It opens
          the business page, so a customer who has just copied their words has to spot "Write a
          review" and tap again — which is exactly where people give up. Said plainly here rather
          than left for the owner to discover from a customer who never posted.
        */}
        {testableKind === 'listing' && (
          <div className="flex flex-col gap-1.5 rounded-card border border-warning bg-warning-soft p-4 text-sm">
            <p className="font-semibold text-ink">
              This link opens your listing, not the review box.
            </p>
            <p className="text-ink-muted">
              It works, but your customer lands on your Google page and has to find “Write a review”
              themselves. The link from <strong>Ask for reviews</strong> in your Business Profile
              opens the review box straight away, with their draft ready to paste.
            </p>
            <button
              type="button"
              onClick={() => setHelpOpen(true)}
              className={`self-start rounded font-semibold text-accent ${FOCUS_RING}`}
            >
              Show me how to find it
            </button>
          </div>
        )}

        {testableUrl !== null && (
          <div className="flex flex-col gap-1.5 rounded-card border border-line bg-surface p-4 text-sm">
            <p className="text-ink">
              We can tell that this is a Google link. Only you can tell that it opens <em>your</em>{' '}
              business — please check it once.
            </p>
            <a
              href={testableUrl}
              target="_blank"
              rel="noreferrer noopener"
              className={`self-start rounded font-semibold text-accent ${FOCUS_RING}`}
            >
              {/* The visible text states where the link goes, so no sr-only duplicate is needed. */}
              Open the link in a new tab
            </a>
          </div>
        )}

        <ReviewLinkHelp open={helpOpen} onOpenChange={setHelpOpen} />
      </div>
    </WizardShell>
  );
}

/**
 * "How to find my Google review link" — the spec's third action on this screen.
 *
 * Written out properly because this is the step support gets asked about: a shop owner who cannot
 * find the link either abandons setup or pastes their website. A native `<details>` rather than a
 * modal, so it can be read beside the field without leaving the step and so keyboard operation and
 * find-in-page work without any JavaScript of ours (AC-037). It is controlled only so that a
 * rejection can open it.
 *
 * Both routes are given rather than only the one that happens to be current, and each step names
 * what to look for as well as where, because Google renames these menus periodically. The open /
 * closed state is carried by a glyph as well as by the disclosure itself, never by colour.
 */
function ReviewLinkHelp({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <details
      open={open}
      onToggle={(event) => onOpenChange(event.newState === 'open')}
      className="rounded-card border border-line bg-surface"
    >
      <summary
        className={`flex cursor-pointer list-none items-center gap-2 rounded-card px-4 py-3 text-sm font-semibold text-accent [&::-webkit-details-marker]:hidden ${FOCUS_RING}`}
      >
        <span aria-hidden="true" className="w-3 text-center">
          {open ? '−' : '+'}
        </span>
        How to find my Google review link
      </summary>

      <div className="flex flex-col gap-5 border-t border-line px-4 py-4 text-sm text-ink">
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-ink">
            From your Google Business Profile — the better link
          </h2>
          <ol className="ml-5 flex list-decimal flex-col gap-1.5">
            <li>Sign in to the Google account that manages your business.</li>
            <li>
              Search Google for your business name, or open{' '}
              <span className="break-all">business.google.com</span>. Signed in as the owner you
              will see your own business panel, with buttons such as <em>Edit profile</em>,{' '}
              <em>Read reviews</em> and <em>Promote</em>.
            </li>
            <li>
              Choose <em>Ask for reviews</em>. On some accounts it sits under <em>Promote</em>, or
              is called <em>Get more reviews</em>.
            </li>
            <li>
              Google shows a short link like{' '}
              <span className="break-all">https://g.page/r/…/review</span>. Copy the whole thing.
            </li>
            <li>Paste it in the box above and press Validate link.</li>
          </ol>
          <p className="text-ink-muted">
            This link opens the write-a-review box straight away, so your customer has one tap less
            to do. Prefer it if you can get it.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-ink">From Google Maps — works on any phone</h2>
          <ol className="ml-5 flex list-decimal flex-col gap-1.5">
            <li>
              Open the Google Maps app, or <span className="break-all">maps.google.com</span>, and
              search for your business.
            </li>
            <li>Open your own listing — the page with your photos, hours and reviews on it.</li>
            <li>
              Tap <em>Share</em>. In the app it is the arrow icon; on a computer it is in the menu
              beside your business name.
            </li>
            <li>
              Tap <em>Copy link</em>. You get a short link like{' '}
              <span className="break-all">https://maps.app.goo.gl/…</span>.
            </li>
            <li>Paste it in the box above and press Validate link.</li>
          </ol>
          <p className="text-ink-muted">
            A Maps link opens your listing rather than the review box, so the customer taps once
            more to start writing. It still works.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-ink">If you cannot find it</h2>
          <ul className="ml-5 flex list-disc flex-col gap-1.5">
            <li>
              Google only gives a business a review link once the profile is verified. If yours is
              still waiting on verification, finish that first — the rest of the setup here can be
              done in the meantime.
            </li>
            <li>
              Your website address, a Google search results page, and a link to one existing review
              are three different things, and none of them will work here.
            </li>
            <li>
              If you have more than one branch, each has its own link. Check you copied the one for
              this location.
            </li>
          </ul>
        </section>
      </div>
    </details>
  );
}

/**
 * One JSON mutation, with the error envelope unpacked.
 *
 * Deliberately the same shape as the helper in `AiContextStep.tsx`. Both wizard steps need a PUT
 * and `useFormSubmit` is POST-only; the honest fix is one shared helper in `apps/web/lib`, which
 * is outside this module's paths.
 */
async function sendJson(
  endpoint: string,
  method: 'POST' | 'PUT',
  body: Record<string, unknown>,
): Promise<JsonResult> {
  let response: Response;

  try {
    response = await fetch(endpoint, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    // A network failure, not a rejected request: says so rather than implying the link is wrong.
    return {
      ok: false,
      failure: {
        code: 'NETWORK',
        message: 'Could not reach the server. Check your connection and try again.',
        fields: [],
      },
    };
  }

  const payload = await readJsonBody(response);
  return response.ok ? { ok: true, payload } : { ok: false, failure: readFailure(payload) };
}

/** A body that is missing or not JSON (a proxy's 502 page) is treated as an empty one. */
async function readJsonBody(response: Response): Promise<Record<string, unknown>> {
  if (response.status === 204) return {};

  try {
    const parsed: unknown = await response.json();
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

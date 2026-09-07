'use client';

import { useCallback, useRef, useState } from 'react';
import { Badge, Button, Field, FOCUS_RING, Input } from '@ai-review/ui';
// Type-only, and it has to stay that way. The `@ai-review/core` barrel re-exports the password
// hasher (@node-rs/argon2, a native binary), the Redis rate limiter and the Drizzle tenant guard,
// none of which can exist in a browser bundle. `import type` is erased at compile time under
// verbatimModuleSyntax, so nothing here reaches the client; dropping the `type` keyword would
// fail the build rather than fail quietly.
import type { ReviewUrlRejection } from '@ai-review/core';
import type { SubmitFailure } from '@/components/auth/use-form-submit';
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
 * Four decisions worth stating.
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
 * `useFormSubmit` is not reused: it is POST-only and models one operation per screen, while this
 * screen has two (a check that does not persist, and an idempotent PUT). Its `SubmitFailure` shape
 * and envelope unpacking are reused so the error contract stays in one shape (23_API_Error_Codes).
 */

const ENDPOINT = '/api/v1/business/review-destination';

const REQUIRED_MESSAGE =
  'Add your Google review link to continue — your business cannot be published without it.';

/**
 * A failed *check* is not a failed step: the save re-validates server-side anyway, so the copy says
 * so rather than implying the merchant's link is the problem.
 */
const CHECK_FAILED_MESSAGE =
  'We could not check your link just now. You can still press Continue — the link is checked ' +
  'again when it is saved.';

/** The verdict from the server-side validator, returned by the Server Action the page supplies. */
export type ReviewLinkCheck =
  | { ok: true; url: string; host: string }
  | { ok: false; reason: ReviewUrlRejection; message: string };

export interface ReviewLinkStepProps {
  /** The URL already stored for this business, or null on a first visit. */
  savedUrl: string | null;
  /**
   * Server-side validation that deliberately does not persist. A Server Action, so the
   * authoritative validator runs where it already lives instead of being reimplemented here.
   */
  checkUrl: (url: string) => Promise<ReviewLinkCheck>;
}

/** The rejections that mean "you have the wrong link" — the ones the instructions actually fix. */
const REASONS_WORTH_INSTRUCTIONS: readonly ReviewUrlRejection[] = [
  'UNSUPPORTED_HOST',
  'MISSING_PLACE_REFERENCE',
];

export function ReviewLinkStep({ savedUrl, checkUrl }: ReviewLinkStepProps) {
  const [value, setValue] = useState(savedUrl ?? '');
  const [storedUrl, setStoredUrl] = useState(savedUrl);
  const [valid, setValid] = useState<{ url: string; host: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'checking' | 'saving' | null>(null);
  // Open by default for someone who has no link yet: on this step the instructions are the work,
  // not a footnote. A merchant returning to change a link they already have (AC-017) does not need
  // them in the way.
  const [helpOpen, setHelpOpen] = useState(savedUrl === null);

  /**
   * The value the newest in-flight check or save was issued for.
   *
   * Two jobs. A verdict arriving for a value no longer on screen is discarded, so a slow response
   * can never label text the merchant has since replaced. And because clicking "Validate link"
   * blurs the input first, it collapses the resulting blur-then-click pair into one request.
   * Cleared once a result is applied, so pressing Validate again always re-runs.
   */
  const pending = useRef<string | null>(null);

  const trimmed = value.trim();
  const isSaved = storedUrl !== null && trimmed === storedUrl;

  /**
   * Only ever a server-validated URL: the stored one, or one the validator just accepted. A raw
   * input value must never become an href — `javascript:` and friends are exactly what the scheme
   * and host checks exist to keep out of this field.
   */
  const testableUrl = isSaved ? storedUrl : (valid?.url ?? null);

  const clearVerdict = useCallback(() => {
    // Any edit invalidates what is displayed and any answer still in flight.
    pending.current = null;
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
      if (pending.current === candidate) return;

      pending.current = candidate;
      setBusy('checking');

      try {
        const result = await checkUrl(candidate);
        if (pending.current !== candidate) return;

        if (result.ok) {
          setValid({ url: result.url, host: result.host });
          setError(null);
        } else {
          setValid(null);
          setError(result.message);
          // The instructions are the fix for these two, so surface them instead of leaving the
          // merchant to guess that the disclosure is where the answer is.
          if (REASONS_WORTH_INSTRUCTIONS.includes(result.reason)) setHelpOpen(true);
        }
      } catch {
        if (pending.current !== candidate) return;
        setValid(null);
        setError(CHECK_FAILED_MESSAGE);
      } finally {
        if (pending.current === candidate) pending.current = null;
        setBusy(null);
      }
    },
    [checkUrl],
  );

  const save = useCallback(async (candidate: string): Promise<boolean> => {
    pending.current = candidate;
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
      if (pending.current === candidate) setValue(saved);
      return true;
    } finally {
      pending.current = null;
      setBusy(null);
    }
  }, []);

  const handleContinue = useCallback(async (): Promise<boolean> => {
    if (trimmed.length === 0) {
      setValid(null);
      setError(REQUIRED_MESSAGE);
      return false;
    }
    // Unchanged since it was stored: advance without a write, so passing back through this step
    // does not needlessly invalidate the cached public configuration.
    if (trimmed === storedUrl) return true;
    return save(trimmed);
  }, [trimmed, storedUrl, save]);

  const handleSaveAndExit = useCallback(async (): Promise<boolean> => {
    // Empty is allowed to leave, unlike Continue. This is not a skip — /onboarding resumes here
    // and publish still refuses — and someone using Save & exit on this step is usually leaving in
    // order to go and find the link. Blocking the exit would strand them on it.
    if (trimmed.length === 0) return true;
    if (trimmed === storedUrl) return true;
    return save(trimmed);
  }, [trimmed, storedUrl, save]);

  const normalizedDiffers = valid !== null && valid.url !== trimmed;

  return (
    <WizardShell
      stepId="review-link"
      heading="Where should customers leave their review?"
      description="Everyone who copies a review is sent to this link, so it is worth checking carefully. You can change it later without reprinting your QR code."
      onContinue={handleContinue}
      onSaveAndExit={handleSaveAndExit}
      busy={busy !== null}
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
                if (trimmed.length > 0 && !isSaved && valid === null && error === null) {
                  void runCheck(trimmed);
                }
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

type JsonResult =
  { ok: true; payload: Record<string, unknown> } | { ok: false; failure: SubmitFailure };

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

function readFailure(payload: Record<string, unknown>): SubmitFailure {
  const fallback: SubmitFailure = {
    code: 'INTERNAL_ERROR',
    message: 'We could not save your link just now. Please try again.',
    fields: [],
  };

  const error = payload.error;
  if (typeof error !== 'object' || error === null) return fallback;

  const { code, message, details } = error as Record<string, unknown>;
  const fields = (details as { fields?: unknown } | null | undefined)?.fields;

  return {
    code: typeof code === 'string' ? code : fallback.code,
    message: typeof message === 'string' ? message : fallback.message,
    fields: Array.isArray(fields) ? fields.filter((f): f is string => typeof f === 'string') : [],
  };
}

/** The normalized URL the API stored, which is what gets shown back (ONB-02-03). */
function readUrl(payload: Record<string, unknown>): string | null {
  const { url } = payload;
  return typeof url === 'string' && url.length > 0 ? url : null;
}

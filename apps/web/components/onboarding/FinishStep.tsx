'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  FOCUS_RING,
  Field,
  InlineError,
  Input,
  Spinner,
  TOUCH_TARGET,
  cx,
} from '@ai-review/ui';
import { useFormSubmit, type SubmitState } from '@/components/auth/use-form-submit';
import { WizardShell } from './WizardShell';
import { stepById, type OnboardingStepId } from './steps';

/**
 * ONB-05 — publish, and the first QR (Flow A steps 8-12).
 *
 * The three states the screen spec names map onto one `phase`:
 *
 *  - `draft`      — nothing public exists yet. The previews show what will go live, and anything
 *                   publish would refuse is listed with a link to the step that fixes it.
 *  - `publishing` — the POST is in flight. WizardShell owns the button spinner.
 *  - `live`       — the canonical address resolves (ONB-05-02) and the QR exists (ONB-05-01).
 *
 * What this screen must never say. The platform can observe that Google was opened and nothing
 * past it (D-028, AC-025), so every description of the customer journey below stops there. No
 * star rating appears anywhere on the customer side, so none is previewed here (D-009, AC-006).
 * Context terms are described as hints, because that is all they are (D-025, AC-010).
 */

export interface PreviewSection {
  /** business_links.id, or a synthetic id for the default section publish will create. */
  id: string;
  label: string;
  /** The Review Us button, which is the public page primary action wherever it sits (D-015). */
  isPrimary: boolean;
}

export interface FinishQrCode {
  /** qr_codes.id — what GET /qr/{id}/download takes. */
  id: string;
  code: string;
  label: string;
  scanUrl: string;
}

export interface FinishStepProps {
  published: boolean;
  businessName: string;
  description: string | null;
  hasLogo: boolean;
  sections: readonly PreviewSection[];
  /** null until ONB-01 has reserved a web address. */
  canonicalUrl: string | null;
  qrCode: FinishQrCode | null;
  reviewModeName: string | null;
  contextTerms: readonly string[];
  /** Publish requirements not yet met, in the endpoint own `details.missing` vocabulary. */
  missing: readonly string[];
}

const PUBLISH_ENDPOINT = '/api/v1/business/publish';
const PREVIEW_ENDPOINT = '/api/v1/ai/test-preview';

/** How many context terms are shown before the rest are summarised. */
const TERMS_SHOWN = 6;

/**
 * Every requirement the publish endpoint can name, and the step that satisfies it.
 *
 * One table serves both paths — the list derived server-side on render, and the `details.missing`
 * of a 409 — so the two cannot label the same key differently. Paths come from `steps.ts` rather
 * than as strings, because that file is the contract for where a step lives.
 */
const REQUIREMENTS: Record<string, { label: string; step: OnboardingStepId }> = {
  business_details: { label: 'Your business name, category and city', step: 'business' },
  web_address: { label: 'Your web address', step: 'business' },
  google_review_link: { label: 'Your Google review link', step: 'review-link' },
};

/** Anchors styled as buttons: see the download links for why these are not `Button`s. */
const ACTION_BASE =
  'inline-flex items-center justify-center gap-2 rounded-control border px-4 ' +
  'font-semibold no-underline transition-colors';
const ACTION_PRIMARY = 'bg-accent text-on-accent border-transparent hover:bg-accent-hover';
const ACTION_SECONDARY = 'bg-bg text-ink border-line-strong hover:bg-surface';

const TEXT_LINK = 'rounded font-semibold text-accent';

interface Blocker {
  key: string;
  label: string;
  /** null when the endpoint named a requirement this screen has not been taught. */
  step: OnboardingStepId | null;
}

interface Refusal {
  message: string;
  /** Keys from `details.missing`, when the failure carried them. */
  missing: readonly string[] | null;
}

interface Publication {
  publicUrl: string | null;
  qrCode: string | null;
}

type Phase = 'draft' | 'publishing' | 'live';

export function FinishStep({
  published,
  businessName,
  description,
  hasLogo,
  sections,
  canonicalUrl,
  qrCode,
  reviewModeName,
  contextTerms,
  missing,
}: FinishStepProps) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>(published ? 'live' : 'draft');
  const [publication, setPublication] = useState<Publication | null>(null);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'blocked'>('idle');
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const preview = useFormSubmit(PREVIEW_ENDPOINT);
  const requestPreview = preview.submit;

  const live = phase === 'live';
  // The publish response is authoritative the moment it lands; the server-rendered value covers a
  // tenant that was already published when the page loaded.
  const publicUrl = publication?.publicUrl ?? canonicalUrl;
  // A refusal is fresher than anything derived at render time, which is the point of reading it.
  const blockers = (refusal?.missing ?? missing).map(describeBlocker);

  useEffect(() => () => clearTimer(copyTimer), []);

  // A refresh can reveal that the tenant is already live — published in another tab, or by support
  // with the owner watching (Flow B step 5). The server-rendered fact outranks the phase this
  // screen happened to start in, so a stale draft state cannot survive a re-render.
  useEffect(() => {
    if (published) setPhase('live');
  }, [published]);

  /**
   * Publishes, and deliberately does not use `useFormSubmit`.
   *
   * The shared hook keeps only `details.fields` off the error envelope, which is the right shape
   * for a form. This screen needs `details.missing` to say which step to fix, and widening a hook
   * four other screens depend on for one caller is the wrong trade — so the envelope is unpacked
   * here instead.
   */
  const publish = useCallback(async (): Promise<boolean> => {
    setPhase('publishing');
    setRefusal(null);

    try {
      const response = await fetch(PUBLISH_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const payload: unknown = await response.json();

      if (!response.ok) {
        setRefusal(readRefusal(payload));
        setPhase('draft');
        // The tenant changed between render and click, so what this screen derived is stale.
        // Re-rendering the server component re-derives it from the database rather than leaving
        // two disagreeing lists on one screen.
        router.refresh();
        return false;
      }

      setPublication(readPublication(payload));
      setPhase('live');
      // ONB-05-01 creates the QR inside the publish transaction, but the download endpoint takes
      // the row id and the response carries only the printed code. The server render has the id,
      // so this refresh is what makes Download QR work without a manual reload.
      router.refresh();
      // On the final step there is no next path, so the shell stays here either way and the
      // screen reveals its live state itself. `true` is still the honest answer.
      return true;
    } catch {
      setRefusal({
        message: 'Could not reach the server. Check your connection and try again.',
        missing: null,
      });
      setPhase('draft');
      return false;
    }
  }, [router]);

  const handleContinue = useCallback(async (): Promise<boolean> => {
    // Flow A step 12: once live, the primary action is the dashboard. Leaving the wizard is not
    // step navigation, so the shell has no route of its own for it.
    if (live) {
      router.push('/app');
      return true;
    }

    // Attempts even when blockers are listed above. The endpoint holds the same checks and is the
    // only authority on readiness; a list derived at render time can be stale in both directions,
    // and refusing locally would strand an owner who fixed the last item in another tab. The list
    // exists so nobody discovers a requirement by being refused, not to gate the button.
    return publish();
  }, [live, publish, router]);

  const copyAddress = useCallback(async () => {
    if (!publicUrl) return;
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopyState('copied');
    } catch {
      // Clipboard access can be refused outright — an insecure context, a locked-down browser.
      // The address stays selectable in the field above, so say that rather than fail silently.
      setCopyState('blocked');
    }
    clearTimer(copyTimer);
    copyTimer.current = setTimeout(() => setCopyState('idle'), 6000);
  }, [publicUrl]);

  const previewText = previewDraft(preview.state);
  const previewFailure = preview.state.status === 'error' ? preview.state.failure.message : null;
  const extraSections = sections.filter((section) => !section.isPrimary);

  return (
    <WizardShell
      stepId="finish"
      heading={live ? 'Your page is live' : 'Publish your page'}
      description={
        live
          ? 'Print the QR code, put it where your customers are, and you are ready.'
          : 'Publishing puts your page at your own address and creates your first QR code.'
      }
      onContinue={handleContinue}
      busy={phase === 'publishing'}
      continueLabel={live ? 'Go to dashboard' : 'Publish my page'}
    >
      {/*
        A live region that exists before it has anything to say, so the phase change is announced
        rather than only shown by the heading swapping over (AC-037).
      */}
      <p role="status" className="sr-only">
        {live ? 'Your business page is live.' : ''}
      </p>

      {live && publicUrl && (
        <Card
          title="Your page address"
          description="This is where your QR code and your messages send customers."
          actions={<Badge tone="success">Live</Badge>}
        >
          <div className="flex flex-col gap-3">
            <Field
              label="Public page address"
              hint="Works immediately, on any device, with no app to install."
            >
              {(control) => (
                <Input
                  {...control}
                  readOnly
                  value={publicUrl}
                  // Selecting on focus makes a manual copy one keystroke, which matters on the
                  // browsers where the clipboard API is unavailable.
                  onFocus={(event) => event.currentTarget.select()}
                />
              )}
            </Field>

            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => void copyAddress()}>
                Copy address
              </Button>
              <a
                href={publicUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={cx(ACTION_BASE, ACTION_SECONDARY, TOUCH_TARGET, FOCUS_RING)}
              >
                Open my page
              </a>
            </div>

            {/* Feedback is a sentence, never a colour change on the button (AC-038). */}
            <p role="status" className="min-h-5 text-sm text-ink-muted">
              {copyState === 'copied' && 'Address copied.'}
              {copyState === 'blocked' &&
                'Your browser blocked the copy — select the address above and copy it.'}
            </p>
          </div>
        </Card>
      )}

      {!live && blockers.length > 0 && (
        <Card
          title="Finish these first"
          description="Your page goes live the moment you publish, so these need to be in place."
        >
          <ul className="m-0 flex list-none flex-col p-0">
            {blockers.map((blocker) => (
              <li key={blocker.key} className={BLOCKER_ROW}>
                <span className="text-sm text-ink">{blocker.label}</span>
                <Link
                  href={blocker.step ? stepById(blocker.step).path : '/onboarding'}
                  className={cx('rounded text-sm font-semibold text-accent', FOCUS_RING)}
                >
                  Add it
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card
        title="Public page preview"
        description="What a customer sees when they scan your QR code or open your address."
        footer="Private feedback is offered to every visitor, alongside Review Us, and nobody is asked to rate you before Google."
      >
        <div className="flex flex-col gap-4 rounded-card border border-line bg-surface p-4">
          <div className="flex items-start gap-3">
            {hasLogo && <span className={LOGO_PLACEHOLDER}>Your logo</span>}
            <div className="min-w-0">
              <p className="m-0 text-lg font-semibold break-words text-ink">
                {businessName || 'Your business name'}
              </p>
              {description && <p className="mt-1 mb-0 text-sm text-ink-muted">{description}</p>}
            </div>
          </div>

          {/*
            Labels only, not links. This is a picture of the page, and real controls here would
            put buttons in the tab order that do nothing on this screen. AC-020 is why nothing
            appears greyed out: a section without a target is absent from the public page, so it
            is absent from the preview.
          */}
          {sections.length > 0 && (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {sections.map((section) => (
                <li
                  key={section.id}
                  className={cx(
                    'rounded-control border px-4 py-2.5 text-center text-sm font-semibold',
                    section.isPrimary
                      ? 'border-transparent bg-accent text-on-accent'
                      : 'border-line-strong bg-bg text-ink',
                  )}
                >
                  {section.label}
                </li>
              ))}
            </ul>
          )}

          <p className="m-0 text-center text-sm text-accent">Send private feedback</p>
        </div>

        {extraSections.length === 0 && (
          <p className="mt-3 mb-0 text-sm text-ink-muted">
            Only Review Us and private feedback will show.{' '}
            <Link href={stepById('links').path} className={cx(TEXT_LINK, FOCUS_RING)}>
              Add ways to reach you
            </Link>{' '}
            — optional, and you can change it later.
          </p>
        )}
      </Card>

      <Card
        title="AI review preview"
        description="A sample of the draft your customers start from."
        footer="Your customer can edit every word, and confirms the draft reflects their genuine experience before they copy it. Copying opens the Google review page in a new tab, and the rest is theirs to do."
      >
        <div className="flex flex-col gap-3">
          {/*
            Not fetched on render. A preview is a real provider call — metered and rate limited —
            and this screen can be reloaded or revisited any number of times, so it happens when
            the owner asks for it. It never touches the free quota either way (ONB-04-02).
          */}
          <div role="status">
            {previewText && <blockquote className={PREVIEW_QUOTE}>{previewText}</blockquote>}
          </div>

          {previewFailure && <InlineError>{previewFailure}</InlineError>}

          <div className="flex flex-col gap-2">
            <div>
              <Button
                variant="secondary"
                loading={preview.state.status === 'submitting'}
                loadingLabel="Writing a sample review"
                onClick={() => void requestPreview({})}
              >
                {previewText ? 'Show another sample' : 'Show a sample review'}
              </Button>
            </div>
            {/* ONB-04-02: a preview is not billable, and an owner will not assume that. */}
            <p className="m-0 text-sm text-ink-muted">
              Samples do not use your 10 free generations.
            </p>
          </div>

          <ContextHints reviewModeName={reviewModeName} contextTerms={contextTerms} />
        </div>
      </Card>

      <Card
        title="Your QR code"
        description={
          live
            ? 'One code, printed once. You can change where it goes at any time without reprinting.'
            : 'Publishing creates your first QR code, and the downloads appear here.'
        }
        footer={
          qrCode
            ? `It resolves through ${qrCode.scanUrl}, so updating your Google link later redirects every printed standee at once.`
            : undefined
        }
      >
        <QrPanel live={live} qrCode={qrCode} pendingCode={publication?.qrCode ?? null} />
      </Card>

      {/*
        Last child, so a refusal sits directly above the button that caused it. The list at the
        top of the screen is the actionable half; this is the reason.
      */}
      {refusal && <InlineError>{refusal.message}</InlineError>}
    </WizardShell>
  );
}

const BLOCKER_ROW =
  'flex flex-wrap items-center justify-between gap-2 border-b border-line py-2.5 ' +
  'first:pt-0 last:border-0 last:pb-0';

const LOGO_PLACEHOLDER =
  'flex size-14 shrink-0 items-center justify-center rounded-control border border-line ' +
  'bg-bg text-center text-xs text-ink-muted';

const PREVIEW_QUOTE = 'm-0 rounded-card border border-line bg-surface p-4 text-sm text-ink';

/**
 * What the drafts will draw on.
 *
 * The wording is load-bearing rather than decorative: D-025 and AC-010 make context terms hints,
 * and there is no setting anywhere that could turn them into required wording. An owner who
 * expects "keywords in every review" needs to be told here, not discover it from their drafts.
 */
function ContextHints({
  reviewModeName,
  contextTerms,
}: {
  reviewModeName: string | null;
  contextTerms: readonly string[];
}) {
  // Deduplicated because these arrive from a jsonb column, which no constraint keeps unique.
  const terms = Array.from(new Set(contextTerms));

  if (reviewModeName === null && terms.length === 0) {
    return (
      <p className="m-0 text-sm text-ink-muted">
        <Link href={stepById('ai').path} className={cx(TEXT_LINK, FOCUS_RING)}>
          Add some context
        </Link>{' '}
        if you want drafts to mention what you actually do — optional.
      </p>
    );
  }

  const shown = terms.slice(0, TERMS_SHOWN);
  const remaining = terms.length - shown.length;

  return (
    <div className="flex flex-col gap-2">
      <p className="m-0 text-sm text-ink-muted">
        {reviewModeName === null
          ? 'Drafts use the context you saved.'
          : `Drafts use your "${reviewModeName}" mode.`}{' '}
        Your terms are hints — a draft uses what fits and never forces them all in.
      </p>

      {shown.length > 0 && (
        <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
          {shown.map((term) => (
            <li key={term}>
              <Badge>{term}</Badge>
            </li>
          ))}
          {remaining > 0 && (
            <li className="self-center text-sm text-ink-muted">and {remaining} more</li>
          )}
        </ul>
      )}
    </div>
  );
}

/**
 * The QR body across the three states.
 *
 * SVG leads because the QR exists to be printed on a standee (D-016) and vector artwork is what a
 * printer wants; PNG is the convenience format. Neither is generated here — GET
 * /qr/{id}/download owns that.
 */
function QrPanel({
  live,
  qrCode,
  pendingCode,
}: {
  live: boolean;
  qrCode: FinishQrCode | null;
  pendingCode: string | null;
}) {
  if (!live) {
    return (
      <p className="m-0 text-sm text-ink-muted">
        It will be a dynamic code called Main QR, downloadable as SVG for printing or PNG for
        sharing.
      </p>
    );
  }

  if (!qrCode) {
    // The publish response carries the printed code but not the row id the download endpoint
    // needs, so the buttons arrive a moment later with the refreshed render.
    return (
      <p className="m-0 flex items-center gap-2 text-sm text-ink-muted">
        <Spinner />
        <span>
          Preparing your QR code{pendingCode ? ` (${pendingCode})` : ''}. You can also download it
          any time from your dashboard.
        </span>
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 text-sm text-ink-muted">
        {qrCode.label} · code <span className="font-semibold text-ink">{qrCode.code}</span>
      </p>

      {/*
        Anchors, not `Button`s. A download is a link — it has to survive a middle-click, a
        right-click and being announced as a link — and the kit `Button` renders a `<button>` with
        no polymorphic escape hatch. The button treatment is composed from the kit shared class
        tokens so the focus ring and touch target stay identical to a real one (AC-037).
      */}
      {/*
        The filename is set here rather than left to Content-Disposition: it carries the printed
        code, which is what matches a file to a standee on a print order, and it means the file
        does not land in Downloads called "download" if the endpoint sends no header.
      */}
      <div className="flex flex-wrap gap-2">
        <a
          href={`/api/v1/qr/${qrCode.id}/download?format=svg`}
          download={`qr-${qrCode.code}.svg`}
          className={cx(ACTION_BASE, ACTION_PRIMARY, TOUCH_TARGET, FOCUS_RING)}
        >
          Download SVG
        </a>
        <a
          href={`/api/v1/qr/${qrCode.id}/download?format=png`}
          download={`qr-${qrCode.code}.png`}
          className={cx(ACTION_BASE, ACTION_SECONDARY, TOUCH_TARGET, FOCUS_RING)}
        >
          Download PNG
        </a>
      </div>

      <p className="m-0 text-sm text-ink-muted">
        Take the SVG to your printer: it stays sharp at any size, which is what a standee needs. The
        PNG is for a quick share or an on-screen check.
      </p>
    </div>
  );
}

function describeBlocker(key: string): Blocker {
  const known = REQUIREMENTS[key];
  if (known) return { key, label: known.label, step: known.step };

  // Forward compatibility: publish may grow a requirement this screen predates. Showing a raw key
  // with no way forward is a dead end, so it goes to the resume router, which derives the right
  // step from the tenant itself.
  return { key, label: humanizeKey(key), step: null };
}

function humanizeKey(key: string): string {
  const words = key.replaceAll('_', ' ').trim();
  return words.length > 0 ? `${words.charAt(0).toUpperCase()}${words.slice(1)}` : 'One more detail';
}

function previewDraft(state: SubmitState): string | null {
  if (state.status !== 'success') return null;
  const text = state.payload.review_text;
  return typeof text === 'string' && text.trim().length > 0 ? text.trim() : null;
}

function readRefusal(payload: unknown): Refusal {
  const fallback: Refusal = { message: 'Something went wrong. Please try again.', missing: null };
  if (typeof payload !== 'object' || payload === null || !('error' in payload)) return fallback;

  const error = (payload as { error: Record<string, unknown> }).error;
  const details = error.details as { missing?: unknown } | undefined;

  return {
    // 23_API_Error_Codes.md guarantees a safe, user-facing message on every failure, so it is
    // shown as sent rather than remapped from the code here.
    message: typeof error.message === 'string' ? error.message : fallback.message,
    missing: Array.isArray(details?.missing)
      ? details.missing.filter((key): key is string => typeof key === 'string')
      : null,
  };
}

function readPublication(payload: unknown): Publication {
  const record =
    typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {};

  return {
    publicUrl: typeof record.public_url === 'string' ? record.public_url : null,
    qrCode: typeof record.qr_code === 'string' ? record.qr_code : null,
  };
}

function clearTimer(ref: { current: ReturnType<typeof setTimeout> | null }): void {
  if (ref.current !== null) {
    clearTimeout(ref.current);
    ref.current = null;
  }
}

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
import { useFormSubmit } from '@/components/auth/use-form-submit';
import { QrStandeePreview } from '@/components/qr/QrStandeePreview';
import { WizardShell } from './WizardShell';
import { stepById, type BusinessLifecycle } from './steps';
import {
  describeBlocker,
  previewDraft,
  readPublication,
  readRefusal,
  showsOnlyDefaultSections,
  type PreviewSection,
  type Publication,
  type Refusal,
} from './finish-preview';

// Re-exported so callers can keep taking the props type from the component that owns the props.
export type { PreviewSection };

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

export interface FinishQrCode {
  /** qr_codes.id — what GET /qr/{id}/download takes. */
  id: string;
  code: string;
  label: string;
  scanUrl: string;
  /**
   * The symbol itself, as a data URI, rendered by the server from lib/qr-image — the same encoder
   * the download endpoint uses. An owner who has just published should be able to see the thing
   * they came here for without opening a file first.
   */
  previewSrc: string;
}

export interface FinishStepProps {
  published: boolean;
  /**
   * The tenant's lifecycle state, carried separately from `published`.
   *
   * SUSPENDED and CLOSED tenants HAVE published, but the publish endpoint refuses them outright
   * (BUSINESS_NOT_ACTIVE). Treating them as merely "published" would offer a Publish button that
   * cannot succeed; treating them as unpublished would describe a live-then-suspended page as
   * never launched. Both are wrong, so the state is explicit.
   */
  lifecycle: BusinessLifecycle;
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

/** Anchors styled as buttons: see the download links for why these are not `Button`s. */
const ACTION_BASE =
  'inline-flex items-center justify-center gap-2 rounded-control border px-4 ' +
  'font-semibold no-underline transition-colors';
const ACTION_PRIMARY = 'bg-accent text-on-accent border-transparent hover:bg-accent-hover';
const ACTION_SECONDARY = 'bg-bg text-ink border-line-strong hover:bg-surface';

const TEXT_LINK = 'rounded font-semibold text-accent';

type Phase = 'draft' | 'publishing' | 'live';

export function FinishStep({
  published,
  lifecycle,
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
  // Nothing on this screen can move a suspended or closed tenant forward — publish refuses it,
  // and the resolution is commercial or support, not a button here.
  const halted = lifecycle === 'SUSPENDED' || lifecycle === 'CLOSED';
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
  // True only when the Review Us row is actually in the preview and nothing else is. With no
  // sections at all the blocker card above is already saying what is missing, so this stays
  // silent rather than promising a button the preview box does not show.
  const offerMoreLinks = showsOnlyDefaultSections(sections);

  // A suspended or closed tenant has already published, so neither the draft nor the live copy
  // fits: publish would be refused, and "your page is live" is not true either. Say what the
  // state actually is and point at the only route out of it, which is not a button on this screen.
  const haltedHeading = !halted
    ? null
    : lifecycle === 'SUSPENDED'
      ? 'Your page is paused'
      : 'This account is closed';
  const haltedDescription =
    lifecycle === 'SUSPENDED'
      ? 'Your public page and QR codes are not serving customers at the moment. Contact support and we will go through it with you.'
      : 'This business account has been closed, so its page and QR codes are switched off.';

  return (
    <WizardShell
      stepId="finish"
      heading={haltedHeading ?? (live ? 'Your page is live' : 'Publish your page')}
      description={
        halted
          ? haltedDescription
          : live
            ? 'Print the QR code, put it where your customers are, and you are ready.'
            : 'Publishing puts your page at your own address and creates your first QR code.'
      }
      onContinue={handleContinue}
      busy={phase === 'publishing'}
      continueLabel={halted || live ? 'Go to dashboard' : 'Publish my page'}
    >
      {halted && (
        <div
          role="status"
          className="rounded-md border border-danger/40 bg-danger-soft px-4 py-3 text-sm text-ink"
        >
          <p className="font-semibold">{haltedHeading}</p>
          <p className="mt-1 text-ink-muted">{haltedDescription}</p>
        </div>
      )}
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

        {offerMoreLinks && (
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
        title="Ai review preview"
        description="A sample of the draft your customers start from."
        footer="Your customer can edit every word, and confirms the draft reflects their genuine experience before they copy it. They then open the Google review page in a new tab, and the rest is theirs to do."
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
            ? 'One clean card, printed once. You can change where it goes at any time without reprinting.'
            : 'Publishing creates your first print-ready QR card, and the downloads appear here.'
        }
        footer={
          qrCode
            ? `It resolves through ${qrCode.scanUrl}, so updating your Google link later redirects every printed standee at once.`
            : undefined
        }
      >
        <QrPanel
          live={live}
          businessName={businessName}
          qrCode={qrCode}
          pendingCode={publication?.qrCode ?? null}
        />
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
  businessName,
  qrCode,
  pendingCode,
}: {
  live: boolean;
  businessName: string;
  qrCode: FinishQrCode | null;
  pendingCode: string | null;
}) {
  if (!live) {
    return (
      <p className="m-0 text-sm text-ink-muted">
        It will be a dynamic card called Main QR, downloadable as SVG for printing or PNG for
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
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
      <div className="mx-auto w-44 shrink-0 sm:mx-0">
        <QrStandeePreview
          businessName={businessName}
          qrSrc={qrCode.previewSrc}
          sourceCode={qrCode.code}
        />
      </div>

      <div className="flex min-w-0 flex-col gap-3">
        <p className="m-0 text-sm text-ink-muted">
          {qrCode.label} · code <span className="font-semibold text-ink">{qrCode.code}</span>
        </p>
        <p className="m-0 text-sm text-ink-muted">
          Scan it with your own phone before you print it. You should land on your review page.
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
            Download print SVG
          </a>
          <a
            href={`/api/v1/qr/${qrCode.id}/download?format=png`}
            download={`qr-${qrCode.code}.png`}
            className={cx(ACTION_BASE, ACTION_SECONDARY, TOUCH_TARGET, FOCUS_RING)}
          >
            Download print PNG
          </a>
        </div>

        <p className="m-0 text-sm text-ink-muted">
          Take the SVG to your printer: it stays sharp at any size, which is what a standee needs.
          The PNG is for a quick share or an on-screen check.
        </p>
      </div>
    </div>
  );
}

function clearTimer(ref: { current: ReturnType<typeof setTimeout> | null }): void {
  if (ref.current !== null) {
    clearTimeout(ref.current);
    ref.current = null;
  }
}

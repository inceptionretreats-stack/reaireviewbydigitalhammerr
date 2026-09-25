'use client';

import { useCallback, useState } from 'react';
import { Button, Card, Field, InlineError, Select, TagInput, Textarea } from '@ai-review/ui';
import type { SubmitFailure } from '@/components/shared/forms/use-form-submit';
import {
  DRAFT_LANGUAGE_HINT,
  DRAFT_LANGUAGE_LABEL,
  DRAFT_LANGUAGE_OPTIONS,
  isDraftLanguage,
  type DraftLanguage,
} from '@/lib/ai/draft-language';
import {
  SUMMARY_MAX,
  contextSignature,
  defaultModeCopy,
  previewFromPayload,
  previewIsStale,
  sendJson,
  summaryAnnouncement,
  summaryCounterText,
  type PreviewState,
} from './ai-context';
import { WizardShell } from './WizardShell';

/**
 * ONB-04 — AI business context.
 *
 * The screen spec lists four fields (business summary, services/products, context terms, default
 * mode name), two actions (Generate preview, Continue) and four states (default, preview loading,
 * preview ready, AI error). Fields are rendered in the spec's order, with one addition after the
 * context terms: the draft language (CHANGE-003), which the spec's English-only V1 never needed.
 *
 * Everything this screen *decides* lives in ./ai-context — envelope parsing, the preview state
 * machine, the stale-preview signature, the counter's announcement thresholds and what the mode
 * card may truthfully claim — so it is unit-tested rather than only eyeballed. What is left here is
 * markup and copy, and the copy is shaped by three product decisions at least as much as the
 * controls are.
 *
 * D-025 / AC-010 / ONB-04-01 — merchant terms are context, never mandatory output. The field is
 * labelled "Business context" and carries the helper text from 09_AI_Prompt_and_Generation_Spec.md
 * verbatim. Nothing here can be read as "always include these words", and `aiContextRequest` has
 * no field for such a setting either, so introducing one would take two deliberate edits.
 *
 * ONB-04-02 — the preview consumes no free quota, and the owner is told so *before* pressing the
 * button. The preview exists to build confidence; an owner who suspects it is spending their ten
 * free generations simply will not press it, and the feature fails at the one job it has.
 *
 * ONB-04-03 — the client mirrors the contract's limits (2000 characters; 30 terms of 80, enforced
 * by TagInput) so an over-long entry is stopped as it is typed rather than lost on save. The server
 * stays authoritative: a rejection comes back naming its field and is shown against that control.
 *
 * ADR-008 — what comes back is a draft the *customer* edits and affirms. The endpoint returns
 * `editable_by_customer` and `requires_experience_confirmation` precisely so this screen can say
 * so, so the result is framed as a starting point and never as the review that will be posted.
 *
 * Reliability: an AI failure never blocks Continue. The preview is a convenience, and blocking
 * onboarding on a provider outage is the failure mode AC-036 exists to prevent — including when
 * the failure is the preview's own rate limit (see the endpoint's ./preview-limit).
 */

/**
 * Verbatim from 09_AI_Prompt_and_Generation_Spec.md, "Merchant keywords implementation". The
 * second sentence is the load-bearing one (D-025, AC-010): it is the only place an owner is told,
 * in the moment they are typing terms, that terms are hints. Reworded copy here would be a
 * compliance change disguised as an edit.
 */
const CONTEXT_HELPER =
  'Add services or topics that help Ai understand your business. These are context hints and may ' +
  'not appear in every review.';

export interface AiContextStepProps {
  initialSummary: string;
  initialServices: readonly string[];
  initialContextTerms: readonly string[];
  initialDraftLanguage: DraftLanguage;
  /** Active review mode name, or null when no unarchived mode is switched on. */
  activeModeName: string | null;
  /**
   * Whether the tenant has any review_modes row at all. PUT /ai/context creates Balanced only when
   * there are none, so this is what decides whether the card may promise that (see
   * `defaultModeCopy`).
   */
  hasAnyMode: boolean;
}

export function AiContextStep({
  initialSummary,
  initialServices,
  initialContextTerms,
  initialDraftLanguage,
  activeModeName,
  hasAnyMode,
}: AiContextStepProps) {
  const [summary, setSummary] = useState(initialSummary);
  const [services, setServices] = useState<readonly string[]>(initialServices);
  const [contextTerms, setContextTerms] = useState<readonly string[]>(initialContextTerms);
  const [draftLanguage, setDraftLanguage] = useState<DraftLanguage>(initialDraftLanguage);
  const [saveFailure, setSaveFailure] = useState<SubmitFailure | null>(null);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<PreviewState>({ status: 'idle' });

  const save = useCallback(async (): Promise<boolean> => {
    setSaving(true);
    setSaveFailure(null);

    const result = await sendJson('/api/v1/ai/context', 'PUT', {
      // Omitted rather than sent as an empty string: the handler maps a missing summary to NULL,
      // so clearing the box actually clears what is stored instead of storing "".
      ...(summary.trim() === '' ? {} : { summary: summary.trim() }),
      services,
      context_terms: contextTerms,
      draft_language: draftLanguage,
    });

    setSaving(false);

    if (!result.ok) {
      setSaveFailure(result.failure);
      return false;
    }
    return true;
  }, [summary, services, contextTerms, draftLanguage]);

  const generatePreview = useCallback(async () => {
    setPreview({ status: 'loading' });

    // The preview endpoint builds its prompt from the *stored* context (loadGenerationContext
    // reads ai_business_contexts), so the form has to be saved first. Skipping this would show a
    // draft generated without the terms the owner just typed, and they would reasonably conclude
    // their terms are ignored — the opposite of what D-025 needs them to understand.
    if (!(await save())) {
      setPreview({ status: 'idle' });
      return;
    }

    const result = await sendJson('/api/v1/ai/test-preview', 'POST', {});

    if (!result.ok) {
      // The API supplies a safe, user-facing message for every failure (23_API_Error_Codes.md),
      // so it is shown verbatim rather than remapped — including on the 429 the preview's own
      // rate limit produces, where a generic "try again" would hide that waiting is the fix.
      setPreview({ status: 'error', message: result.failure.message });
      return;
    }

    const signature = contextSignature(summary, services, contextTerms, draftLanguage);
    setPreview(previewFromPayload(result.payload, signature));
  }, [save, summary, services, contextTerms, draftLanguage]);

  const fieldFailure = (name: string): string | null =>
    saveFailure !== null && saveFailure.fields.includes(name) ? saveFailure.message : null;

  const summaryRemaining = SUMMARY_MAX - summary.length;
  const previewLoading = preview.status === 'loading';
  const previewStale = previewIsStale(
    preview,
    contextSignature(summary, services, contextTerms, draftLanguage),
  );
  const modeCopy = defaultModeCopy({ activeModeName, hasAnyMode });

  return (
    <WizardShell
      stepId="ai"
      heading="Tell the assistant about your business"
      description={
        'Background for the draft your customers start from. Everything here is optional, and ' +
        'you can change it later.'
      }
      onContinue={save}
      onSaveAndExit={save}
      busy={saving}
    >
      <div className="flex flex-col gap-6">
        {/* A failure naming no field belongs at the top, not beside an arbitrary control. */}
        {saveFailure !== null && saveFailure.fields.length === 0 && (
          <InlineError>{saveFailure.message}</InlineError>
        )}

        <Field
          label="Business summary"
          hint="A few sentences on what you do and what people come to you for."
          error={fieldFailure('summary')}
        >
          {(control) => (
            <>
              <Textarea
                {...control}
                name="summary"
                value={summary}
                maxLength={SUMMARY_MAX}
                disabled={saving}
                onChange={(event) => setSummary(event.target.value)}
              />
              {/*
                The exact count, updated on every keystroke, for anyone who can see it. It is not
                itself a live region: a polite region queues one utterance per character, so
                announcing this text would bury an owner's typing echo under two hundred of them.
                `aria-hidden` so the milestone region below is the single announced source rather
                than a second, contradictory reading of the same number.
              */}
              <p aria-hidden="true" className="text-sm text-ink-muted">
                {summaryCounterText(summaryRemaining)}
              </p>
              {/*
                The announced version, bucketed by `summaryAnnouncement` into three thresholds and
                a "full" message, so a screen reader hears four utterances across the last 200
                characters rather than two hundred. Always
                rendered and only its text changes: a live region created at the moment its content
                first appears is frequently not announced at all. An empty <p> generates no line
                box, so it costs no layout.
              */}
              <p aria-live="polite" className="sr-only">
                {summaryAnnouncement(summaryRemaining)}
              </p>
            </>
          )}
        </Field>

        <Field
          label="Services or products"
          hint="The things people actually buy or book. Press Enter or comma after each one."
          error={fieldFailure('services')}
        >
          {(control) => (
            <TagInput
              {...control}
              value={services}
              onChange={setServices}
              disabled={saving}
              placeholder="Haircut"
            />
          )}
        </Field>

        {/*
          Labelled "Business context", which 09_AI_Prompt_and_Generation_Spec.md names as the
          preferred label over "Keywords" — that word invites precisely the expectation D-025
          refuses, and an owner who reads "keywords" will believe they buy guaranteed wording.
        */}
        <Field label="Business context" hint={CONTEXT_HELPER} error={fieldFailure('context_terms')}>
          {(control) => (
            <TagInput
              {...control}
              value={contextTerms}
              onChange={setContextTerms}
              disabled={saving}
              placeholder="Family friendly"
            />
          )}
        </Field>

        {/*
          CHANGE-003. The language the draft is written in. A native select rather than radios:
          the UI kit has none, and two options do not earn a new control. Defaults to Hinglish
          for a new business — the market is India, and the customer keeps the final say over
          every word regardless.
        */}
        <Field
          label={DRAFT_LANGUAGE_LABEL}
          hint={DRAFT_LANGUAGE_HINT}
          error={fieldFailure('draft_language')}
        >
          {(control) => (
            <Select
              {...control}
              name="draft_language"
              options={DRAFT_LANGUAGE_OPTIONS}
              value={draftLanguage}
              onChange={(event) => {
                if (isDraftLanguage(event.target.value)) setDraftLanguage(event.target.value);
              }}
              disabled={saving}
            />
          )}
        </Field>

        {/*
          "Default mode name" is a field in the screen spec, but PUT /ai/context has no field for
          it: the handler creates a Balanced mode itself on first save, and `aiContextRequest`
          would strip a name sent alongside. An editable input whose value is silently discarded is
          worse than no input, so the mode is reported rather than edited, and the owner is told
          where renaming lives. AI-02 owns renaming.

          What it reports comes from `defaultModeCopy`, which distinguishes "no modes at all" —
          the only case where saving creates Balanced — from "modes exist, none switched on". The
          card used to promise the former in both cases, which was a promise the endpoint does not
          keep.

          The second paragraph is AI-02's rule that a mode shifts emphasis and never sentiment,
          said in the owner's language. It is also the answer to "can I make this more positive?",
          which is the question a mode name invites.
        */}
        <Card title="Default review mode" titleAs="h2">
          <p className="text-sm text-ink">
            <span className="font-semibold">{modeCopy.title}</span>
            {modeCopy.note !== null && ` — ${modeCopy.note}`}
          </p>
          <p className="mt-2 text-sm text-ink-muted">
            A mode changes which topics a draft leans on. It never changes how positive a draft is,
            and it never asks anyone for a rating. Rename it or add more modes in Ai settings once
            you are set up.
          </p>
        </Card>

        <Card
          title="See an example draft"
          titleAs="h2"
          description="Previews are free — they never use any of your free customer generations."
        >
          <p className="text-sm text-ink-muted">
            This is the kind of draft a customer sees after scanning your QR code. They can edit
            every word of it, and they confirm it matches their own visit before they copy it.
          </p>

          <div className="mt-3 flex flex-col gap-3">
            <Button
              variant="secondary"
              loading={previewLoading}
              loadingLabel="Writing an example draft"
              // Disabled only while a Continue save is in flight. During the preview's own save
              // `loading` already swallows clicks, and Button deliberately does not set the native
              // disabled attribute, so focus stays where the owner left it (AC-037).
              disabled={saving && !previewLoading}
              onClick={() => void generatePreview()}
            >
              {preview.status === 'ready' ? 'Generate another preview' : 'Generate preview'}
            </Button>

            {/*
              Persistent polite region so a draft is announced when it arrives. The AI error sits
              outside it: InlineError is a role="alert", and an alert nested inside a live region
              is announced twice by some screen readers.
            */}
            <div aria-live="polite" className="flex flex-col gap-2">
              {preview.status === 'ready' && (
                <>
                  <p className="text-xs font-semibold tracking-wider text-ink-muted uppercase">
                    Example draft
                  </p>
                  <blockquote className="rounded-card border border-line bg-surface p-3 text-sm whitespace-pre-line text-ink">
                    {preview.draft}
                  </blockquote>
                  <p className="text-sm text-ink-muted">
                    A starting point, not a finished review: your customer rewrites whatever they
                    like and confirms it reflects their own experience before copying it. Nobody is
                    asked for a star rating on your page.
                  </p>
                  {!preview.compliancePassed && (
                    <p className="text-sm text-ink-muted">
                      This particular draft did not pass our quality checks, so a customer would be
                      shown a different one. Generate another to see a typical result.
                    </p>
                  )}
                  {previewStale && (
                    <p className="text-sm text-ink-muted">
                      Written before your latest edits. Generate another preview to see them
                      included.
                    </p>
                  )}
                </>
              )}
            </div>

            {preview.status === 'error' && (
              <>
                <InlineError>{preview.message}</InlineError>
                {/*
                  AC-036 in spirit: a provider outage must not strand onboarding. The save ran
                  before the provider call and succeeded, so saying the details are safe is both
                  true and the thing the owner needs to hear before pressing Continue.
                */}
                <p className="text-sm text-ink-muted">
                  Your details are saved. Nothing else on this step depends on the preview, so you
                  can carry on and publish.
                </p>
              </>
            )}
          </div>
        </Card>
      </div>
    </WizardShell>
  );
}

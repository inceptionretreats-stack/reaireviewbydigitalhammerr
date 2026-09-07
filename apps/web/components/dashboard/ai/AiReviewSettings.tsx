'use client';

import { useState } from 'react';
import {
  Button,
  Card,
  Field,
  InlineError,
  Modal,
  TagInput,
  Textarea,
  ToastProvider,
  useToast,
} from '@ai-review/ui';
import type { SubmitFailure } from '@/components/auth/use-form-submit';
import { CONTEXT_HELPER, DRAFT_FRAMING_NOTE, PREVIEW_FREE_NOTE } from './copy';
import { sendJson } from './send-json';
import { DRAFT_QUOTE } from './styles';

/**
 * AI-01 — `/app/ai-review`, the form half. All four required states: `saved`, `dirty`,
 * `test loading` and `test result`.
 *
 * It writes through the endpoints that already exist — `PUT /api/v1/ai/context` and
 * `POST /api/v1/ai/test-preview` — rather than new ones. The wizard's ONB-04 step writes the same
 * two, which is why the fields here match it field for field: an owner who set this up during
 * onboarding must find their own words on this screen, not a second, differently shaped copy of
 * them.
 *
 * AI-01-01: the test consumes no quota, and the owner is told so before pressing the button rather
 * than after. `/ai/test-preview` deliberately bypasses QuotaService for this, and it returns
 * `counts_toward_quota: false` so the claim is the endpoint's rather than this screen's.
 *
 * AI-01-02: there is no control here for the global system prompt, and none of the copy quotes it.
 * The prompt lives in `ai_prompt_versions` (ADR-006), is admin-only, and neither endpoint this
 * screen calls reads or writes it. What the owner gets instead is an explanation of what the
 * assistant does with their context — see `PromptExplanation`, which the page renders below this
 * form.
 *
 * D-025 / AC-010: the terms are context hints, never mandatory wording. That is stated by
 * `CONTEXT_HELPER`, quoted from the spec, and enforced by the absence of any "must appear" control
 * from this screen and any such field from `aiContextRequest`.
 */

/** `aiContextRequest` caps the summary at 2000; mirrored so a long summary cannot 422 on save. */
const SUMMARY_MAX = 2000;

/** Show the remaining count only near the limit — a counter that ticks from 2000 is noise. */
const SUMMARY_COUNTER_FROM = 200;

/** The four states AI-01 requires: `saved`/`dirty` above, and these two for the test. */
type PreviewState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; draft: string; compliancePassed: boolean; signature: string }
  | { status: 'error'; message: string };

export interface AiReviewSettingsProps {
  initialSummary: string;
  initialServices: readonly string[];
  initialContextTerms: readonly string[];
  /**
   * `businesses.description` — the profile text "Reset to profile details" copies into the summary.
   * Empty when the owner has not written one, which the reset dialog says out loud.
   */
  profileDescription: string;
}

export function AiReviewSettings(props: AiReviewSettingsProps) {
  // Scoped provider: the shared dashboard shell mounts none yet. See the same note in
  // ReviewModesManager — both wrappers should go when the shell grows one.
  return (
    <ToastProvider>
      <ContextForm {...props} />
    </ToastProvider>
  );
}

function ContextForm({
  initialSummary,
  initialServices,
  initialContextTerms,
  profileDescription,
}: AiReviewSettingsProps) {
  const toast = useToast();

  const [summary, setSummary] = useState(initialSummary);
  const [services, setServices] = useState<readonly string[]>(initialServices);
  const [contextTerms, setContextTerms] = useState<readonly string[]>(initialContextTerms);

  // What is stored, as far as this screen knows. Compared against the live fields to answer
  // "dirty or saved", and moved forward only by a save that actually succeeded.
  const [savedSignature, setSavedSignature] = useState(() =>
    contextSignature(initialSummary, initialServices, initialContextTerms),
  );
  const [everSaved, setEverSaved] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saveFailure, setSaveFailure] = useState<SubmitFailure | null>(null);
  const [preview, setPreview] = useState<PreviewState>({ status: 'idle' });
  const [resetOpen, setResetOpen] = useState(false);

  const signature = contextSignature(summary, services, contextTerms);
  const dirty = signature !== savedSignature;

  const save = async (): Promise<boolean> => {
    setSaving(true);
    setSaveFailure(null);

    const result = await sendJson('/api/v1/ai/context', 'PUT', {
      // Omitted rather than sent as an empty string: the handler maps a missing summary to NULL, so
      // clearing the box actually clears what is stored instead of storing "".
      ...(summary.trim() === '' ? {} : { summary: summary.trim() }),
      services,
      context_terms: contextTerms,
    });

    setSaving(false);

    if (!result.ok) {
      setSaveFailure(result.failure);
      return false;
    }

    setSavedSignature(signature);
    setEverSaved(true);
    return true;
  };

  const saveOnly = async (): Promise<void> => {
    if (await save()) {
      toast.show({ tone: 'success', title: 'AI context saved' });
    }
  };

  const testPreview = async (): Promise<void> => {
    setPreview({ status: 'loading' });

    // The preview endpoint builds its prompt from the *stored* context, so unsaved edits have to be
    // saved first. Skipping that would show a draft written without the terms the owner just typed,
    // and they would reasonably conclude their terms are ignored — the opposite of what D-025 needs
    // them to understand. The button says "Save and test preview" while there is anything to save,
    // so the write is never a surprise.
    if (dirty && !(await save())) {
      setPreview({ status: 'idle' });
      return;
    }

    const result = await sendJson('/api/v1/ai/test-preview', 'POST', {});

    if (!result.ok) {
      // The API supplies a safe, user-facing message for every failure (23_API_Error_Codes.md), so
      // it is shown verbatim rather than remapped — including the 429 from the preview's rate
      // limit, where a generic "try again" would hide that waiting is the fix.
      setPreview({ status: 'error', message: result.failure.message });
      return;
    }

    const draft = typeof result.payload.review_text === 'string' ? result.payload.review_text : '';

    if (draft.trim() === '') {
      setPreview({
        status: 'error',
        message: 'The preview came back empty. Please try generating it again.',
      });
      return;
    }

    setPreview({
      status: 'ready',
      draft,
      // The endpoint reports whether the draft cleared the AC-011/AC-012 output gates. Treated as
      // passed when the field is absent, so an unexpected payload cannot raise a false alarm; when
      // it is explicitly false the owner is told, because a draft a customer would never be shown
      // is not a fair sample of the product.
      compliancePassed: result.payload.compliance_passed !== false,
      signature: contextSignature(summary, services, contextTerms),
    });
  };

  const applyProfileReset = (): void => {
    setSummary(profileDescription);
    setServices([]);
    setContextTerms([]);
    setResetOpen(false);
    setSaveFailure(null);
  };

  const fieldFailure = (field: string): string | null =>
    saveFailure !== null && saveFailure.fields.includes(field) ? saveFailure.message : null;

  const summaryRemaining = SUMMARY_MAX - summary.length;
  const previewLoading = preview.status === 'loading';
  const previewStale =
    preview.status === 'ready' &&
    preview.signature !== contextSignature(summary, services, contextTerms);
  const resetWouldChange =
    summary !== profileDescription || services.length > 0 || contextTerms.length > 0;

  return (
    <div className="flex flex-col gap-6">
      <Card
        title="What the assistant knows about you"
        titleAs="h2"
        description="Background for the draft your customers start from. All of it is optional."
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
                  rows={5}
                  value={summary}
                  maxLength={SUMMARY_MAX}
                  disabled={saving}
                  onChange={(event) => setSummary(event.target.value)}
                />
                {/*
                  The region is always rendered and only its text changes: a live region created at
                  the moment its content first appears is frequently not announced at all. An empty
                  <p> generates no line box, so it costs no layout.
                */}
                <p aria-live="polite" className="text-sm text-ink-muted">
                  {summaryRemaining <= SUMMARY_COUNTER_FROM
                    ? `${summaryRemaining} characters left of ${SUMMARY_MAX}.`
                    : ''}
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
            preferred label over "Keywords" — that word invites exactly the expectation D-025
            refuses, and an owner who reads "keywords" will believe they bought guaranteed wording.
          */}
          <Field
            label="Business context"
            hint={CONTEXT_HELPER}
            error={fieldFailure('context_terms')}
          >
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

          <div className="flex flex-col gap-2 border-t border-line pt-4">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                loading={saving && !previewLoading}
                loadingLabel="Saving"
                disabled={!dirty || previewLoading}
                onClick={() => void saveOnly()}
              >
                Save
              </Button>

              <Button
                variant="secondary"
                loading={previewLoading}
                loadingLabel="Writing an example draft"
                // Disabled only while a plain Save is in flight; during the preview's own save
                // `loading` already swallows clicks, and Button deliberately does not set the
                // native disabled attribute, so focus stays where the owner left it (AC-037).
                disabled={saving && !previewLoading}
                onClick={() => void testPreview()}
              >
                {dirty ? 'Save and test preview' : 'Test preview'}
              </Button>

              <Button
                variant="text"
                disabled={saving || previewLoading || !resetWouldChange}
                onClick={() => setResetOpen(true)}
              >
                Reset to profile details
              </Button>
            </div>

            {/*
              The `saved` and `dirty` states of AI-01, in one polite region that is always present.
              The third branch matters: with nothing to save, Save is disabled, and a disabled
              button beside a blank line reads as a broken screen rather than an up-to-date one.
            */}
            <p aria-live="polite" className="text-sm text-ink-muted">
              {dirty
                ? 'Not saved yet. Your customers still see the last saved version.'
                : everSaved
                  ? 'All changes saved.'
                  : 'This matches what is stored.'}
            </p>

            {!resetWouldChange && (
              <p className="text-sm text-ink-faint">
                Nothing to reset — this already matches your business profile.
              </p>
            )}
          </div>
        </div>
      </Card>

      <Card
        title="See an example draft"
        titleAs="h2"
        // AI-01-01, before the button rather than after it.
        description={PREVIEW_FREE_NOTE}
      >
        <p className="text-sm text-ink-muted">
          This is the kind of draft a customer sees after scanning your QR code. They can edit every
          word of it, and they confirm it matches their own visit before they copy it.
        </p>

        <div className="mt-3 flex flex-col gap-3">
          {/*
            Persistent polite region so a draft is announced when it arrives. The error sits outside
            it: InlineError is a role="alert", and an alert nested inside a live region is announced
            twice by some screen readers.
          */}
          <div aria-live="polite" className="flex flex-col gap-2">
            {preview.status === 'ready' && (
              <>
                <p className="text-xs font-semibold tracking-wider text-ink-muted uppercase">
                  Example draft
                </p>
                <blockquote className={DRAFT_QUOTE}>{preview.draft}</blockquote>
                <p className="text-sm text-ink-muted">{DRAFT_FRAMING_NOTE}</p>
                {!preview.compliancePassed && (
                  <p className="text-sm text-ink-muted">
                    This particular draft did not pass our quality checks, so a customer would be
                    shown a different one. Generate another to see a typical result.
                  </p>
                )}
                {previewStale && (
                  <p className="text-sm text-ink-muted">
                    Written before your latest edits. Test again to see them included.
                  </p>
                )}
              </>
            )}
          </div>

          {preview.status === 'error' && (
            <>
              <InlineError>{preview.message}</InlineError>
              {/*
                AC-036 in spirit: an AI outage must not make the rest of the screen unusable. Saving
                does not depend on the provider, so saying so is both true and what the owner needs
                to hear before they walk away from the page.
              */}
              <p className="text-sm text-ink-muted">
                This only affects the example. Your context saves and your public page keeps
                working.
              </p>
            </>
          )}
        </div>
      </Card>

      <Modal
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        title="Reset to profile details"
        description="Nothing is saved until you press Save, so you can still change your mind."
        footer={
          <>
            <Button variant="secondary" onClick={() => setResetOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={applyProfileReset}>
              Reset the fields
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3 text-sm text-ink">
          <p>This replaces what is in the form with what your business profile already says:</p>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-ink-muted">
            <li>
              {profileDescription.trim() === '' ? (
                <>
                  Your business summary is <strong>emptied</strong> — your profile has no
                  description yet, so there is nothing to copy from it.
                </>
              ) : (
                <>Your business summary is replaced by your profile description.</>
              )}
            </li>
            <li>Your services and business context lists are cleared.</li>
          </ul>
          <p className="text-ink-muted">
            Your name, category and city are always sent to the assistant and are not affected.
          </p>
        </div>
      </Modal>
    </div>
  );
}

/**
 * Identifies the context a draft was written from, so a preview can admit it predates the owner's
 * latest edits rather than appearing to reflect them. Doubles as the dirty check.
 */
function contextSignature(
  summary: string,
  services: readonly string[],
  contextTerms: readonly string[],
): string {
  return JSON.stringify([summary.trim(), services, contextTerms]);
}

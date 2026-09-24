'use client';

import { useId, useState } from 'react';
import { Button, Field, InlineError, Input, Modal, TagInput, Textarea } from '@ai-review/ui';
import { MODE_DESCRIPTION_MAX, MODE_NAME_MAX } from '@/lib/ai/modes/schema';
import type { SubmitFailure } from '@/components/shared/forms/use-form-submit';
import { CONTEXT_HELPER, MODE_EMPHASIS_NOTE } from './copy';

/**
 * The `create` and `edit` states of AI-02, in the kit's Modal — the design brief's "drawer/modal
 * for small CRUD", and this is three fields.
 *
 * It holds the draft values and nothing else: the parent owns the list, the request and the
 * failure, so there is one place that knows how a mode is saved. The parent remounts this with a
 * `key` when the target changes, which is what resets the fields — deriving them from props in an
 * effect would leave a half-typed name on screen belonging to the previous row.
 *
 * The field limits come from the endpoint's own parser rather than being restated, so an over-long
 * entry is stopped as it is typed instead of being lost on save (the client mirrors the contract;
 * the server stays authoritative and its rejection is shown against the field it names).
 */

export interface ModeEditorValues {
  name: string;
  description: string;
  contextTerms: readonly string[];
}

export interface ModeEditorProps {
  open: boolean;
  title: string;
  /** Named for what it does to this mode — "Create mode", "Save changes" — never a bare "OK". */
  submitLabel: string;
  initialValues: ModeEditorValues;
  busy: boolean;
  failure: SubmitFailure | null;
  onSubmit: (values: ModeEditorValues) => void;
  onClose: () => void;
}

export function ModeEditor({
  open,
  title,
  submitLabel,
  initialValues,
  busy,
  failure,
  onSubmit,
  onClose,
}: ModeEditorProps) {
  const formId = useId();
  const [name, setName] = useState(initialValues.name);
  const [description, setDescription] = useState(initialValues.description);
  const [contextTerms, setContextTerms] = useState<readonly string[]>(initialValues.contextTerms);

  const fieldFailure = (field: string): string | null =>
    failure !== null && failure.fields.includes(field) ? failure.message : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={MODE_EMPHASIS_NOTE}
      // A half-typed mode should not be lost to a stray click outside the dialog. Escape and the
      // close button still dismiss it, so nobody is trapped.
      dismissOnBackdrop={false}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          {/*
            `form` associates a button outside the form element with it, so Enter in the name field
            submits and the primary action still sits in the dialog footer where the kit puts it.
          */}
          <Button type="submit" form={formId} loading={busy} loadingLabel="Saving">
            {submitLabel}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (busy) return;
          onSubmit({ name, description, contextTerms });
        }}
      >
        {/* A failure naming no field belongs at the top, not beside an arbitrary control. */}
        {failure !== null && failure.fields.length === 0 && (
          <InlineError>{failure.message}</InlineError>
        )}

        <Field label="Mode name" required error={fieldFailure('name')}>
          {(control) => (
            <Input
              {...control}
              name="name"
              value={name}
              maxLength={MODE_NAME_MAX}
              autoComplete="off"
              disabled={busy}
              onChange={(event) => setName(event.target.value)}
            />
          )}
        </Field>

        <Field
          label="Description"
          hint="Optional. A note to yourself about when this mode is the right one."
          error={fieldFailure('description')}
        >
          {(control) => (
            <Textarea
              {...control}
              name="description"
              rows={3}
              value={description}
              maxLength={MODE_DESCRIPTION_MAX}
              disabled={busy}
              onChange={(event) => setDescription(event.target.value)}
            />
          )}
        </Field>

        {/*
          Labelled "Context terms" rather than "Keywords": 09_AI_Prompt_and_Generation_Spec.md names
          the preferred label, because "keywords" invites exactly the expectation D-025 refuses — an
          owner who reads it will believe they have bought guaranteed wording.
        */}
        <Field label="Context terms" hint={CONTEXT_HELPER} error={fieldFailure('context_terms')}>
          {(control) => (
            <TagInput
              {...control}
              value={contextTerms}
              onChange={setContextTerms}
              disabled={busy}
              placeholder="Wood fired pizza"
            />
          )}
        </Field>
      </form>
    </Modal>
  );
}

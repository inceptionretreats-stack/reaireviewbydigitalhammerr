'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, Field, InlineError, Input, Modal, Textarea } from '@ai-review/ui';
import {
  EXAMPLE_LABELS,
  LABEL_MAX,
  NOTE_MAX,
  labelError,
  noteError,
  type QrMutationOutcome,
  type QrSource,
} from './qr-sources';

/**
 * QR-01's `create` state and its Rename action, which are the same two fields.
 *
 * One component for both because the form is identical — a source label and an internal note — and
 * splitting it would be two places to keep the guidance about labels (QR-01-03) in step. What
 * differs is the title, the submit wording, and the block that appears only when editing: the
 * permanent code, stated plainly so an owner can see that renaming does not invalidate the standee
 * they have already printed (QR-01-01).
 *
 * The destination is shown as a fact, not as a disabled `<select>`. There is exactly one
 * destination behaviour in V1 and no column that could hold a second (D-026), so a control here
 * would imply a choice the product does not have.
 */

export interface QrSourceDialogProps {
  open: boolean;
  /** `create` posts a new source; `edit` renames the one in `source`. */
  mode: 'create' | 'edit';
  /** The source being renamed. Required by `edit`, unused by `create`. */
  source?: QrSource | undefined;
  onClose: () => void;
  onSubmit: (input: { sourceLabel: string; internalNote: string }) => Promise<QrMutationOutcome>;
}

interface FieldErrors {
  source_label?: string;
  internal_note?: string;
}

export function QrSourceDialog({ open, mode, source, onClose, onSubmit }: QrSourceDialogProps) {
  const [label, setLabel] = useState('');
  const [note, setNote] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /*
   * Seeds the fields each time the dialog opens, and clears them on close.
   *
   * The dialog is mounted for the life of the screen (Modal returns null while closed), so without
   * this the second source an owner creates would open with the first one's label still in the box,
   * and Rename would show whichever row was renamed last.
   */
  useEffect(() => {
    if (!open) return;
    setLabel(source?.label ?? '');
    setNote(source?.note ?? '');
    setFieldErrors({});
    setFormError(null);
  }, [open, source]);

  const submit = useCallback(async () => {
    const sourceLabel = label.trim();
    const internalNote = note.trim();

    // Checked here for a faster answer; the endpoint re-checks both and is the actual gate.
    const errors: FieldErrors = {};
    const labelMessage = labelError(label);
    const noteMessage = noteError(note);
    if (labelMessage) errors.source_label = labelMessage;
    if (noteMessage) errors.internal_note = noteMessage;

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setFormError(null);
      return;
    }

    setFieldErrors({});
    setFormError(null);
    setBusy(true);

    const outcome = await onSubmit({ sourceLabel, internalNote });

    setBusy(false);

    if (outcome.ok) {
      onClose();
      return;
    }

    // The API returns a safe, user-facing message for every failure (AC-030), so it is shown
    // verbatim rather than remapped. `details.fields` decides whether it belongs under an input or
    // above the form — a message with nowhere to attach would otherwise be an invisible refusal.
    const named = outcome.failure.fields;
    if (named.includes('source_label')) {
      setFieldErrors({ source_label: outcome.failure.message });
    } else if (named.includes('internal_note')) {
      setFieldErrors({ internal_note: outcome.failure.message });
    } else {
      setFormError(outcome.failure.message);
    }
  }, [label, note, onClose, onSubmit]);

  const creating = mode === 'create';
  const labelLeft = LABEL_MAX - label.length;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title={creating ? 'Create a QR code' : 'Rename this QR source'}
      description={
        creating
          ? 'One code per place you print it, so you can tell later where your reviews came from.'
          : 'Only the label and note change. The printed code stays as it is.'
      }
      // No backdrop dismiss: this form holds typed input, and a stray click outside it losing a
      // half-written label is the kind of dismissal that has no undo. Escape and Cancel remain.
      dismissOnBackdrop={false}
      closeLabel="Cancel"
    >
      {/*
        The submit button sits inside the form rather than in Modal's `footer`, which renders
        outside the children container: a form element cannot wrap both. Keeping it here is what
        makes Enter submit the label field, which is how a two-field dialog is expected to behave.
      */}
      <form
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {formError && <InlineError>{formError}</InlineError>}

        {!creating && source && (
          <div className="rounded-card border border-line bg-surface p-3">
            <p className="m-0 text-sm font-medium text-ink">
              Printed code{' '}
              <code className="rounded-control bg-bg px-1.5 py-0.5 font-mono break-all">
                {source.code}
              </code>
            </p>
            {/* QR-01-01 made visible at the moment it matters most: the owner is about to change
                the label and needs to know the standee is unaffected. */}
            <p className="m-0 mt-1 text-sm text-ink-muted">
              This code is permanent and cannot be changed. Renaming the source does not affect any
              standee or sticker you have already printed.
            </p>
          </div>
        )}

        <Field
          label="Source label"
          required
          error={fieldErrors.source_label}
          hint="Where this code will be printed or placed. It is what your reports are grouped by."
        >
          {(control) => (
            <Input
              {...control}
              name="source_label"
              value={label}
              onChange={(event) => {
                setLabel(event.target.value);
                // Clears the message so a correction is not made under a stale error.
                setFieldErrors(({ source_label: _cleared, ...rest }) => rest);
                setFormError(null);
              }}
              maxLength={LABEL_MAX}
              autoComplete="off"
              disabled={busy}
            />
          )}
        </Field>

        {creating && (
          /*
           * QR-01-03: the label is the attribution key in analytics, and an empty list with no
           * guidance is where an owner types "QR 1". Reception and Billing Counter are the pack's
           * own examples; outside the live region because buttons appearing inside one get read
           * out with it.
           */
          <div className="flex flex-col gap-2">
            <p className="m-0 text-sm text-ink-muted">Common labels — pick one to start:</p>
            <div className="flex flex-wrap gap-2">
              {EXAMPLE_LABELS.map((example) => (
                <Button
                  key={example}
                  variant="secondary"
                  disabled={busy}
                  onClick={() => {
                    setLabel(example);
                    setFieldErrors(({ source_label: _cleared, ...rest }) => rest);
                  }}
                >
                  {example}
                  <span className="sr-only"> — use this label</span>
                </Button>
              ))}
            </div>
          </div>
        )}

        <Field
          label="Internal note"
          error={fieldErrors.internal_note}
          hint="Optional, and only you see it — the exact spot it is stuck, or who looks after it."
        >
          {(control) => (
            <Textarea
              {...control}
              name="internal_note"
              value={note}
              onChange={(event) => {
                setNote(event.target.value);
                setFieldErrors(({ internal_note: _cleared, ...rest }) => rest);
                setFormError(null);
              }}
              maxLength={NOTE_MAX}
              rows={3}
              disabled={busy}
            />
          )}
        </Field>

        <div className="rounded-card bg-surface p-3 text-sm text-ink-muted">
          {/* "Destination behavior fixed to AI review V1" from QR-01's field list, as a statement
              rather than a control that does nothing. */}
          <span className="font-medium text-ink">Destination:</span> your AI review page. Every QR
          code goes there, and that cannot be changed in this version.
        </div>

        {/*
          No live counter announcement: a number read out on every keystroke is chatter, and the
          limit is in the hint, which assistive technology reads with the field.
        */}
        {labelLeft <= 20 && (
          <p className="m-0 text-sm text-ink-muted" aria-hidden="true">
            {labelLeft} characters left in the label
          </p>
        )}

        <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="submit"
            loading={busy}
            loadingLabel={creating ? 'Creating your QR code…' : 'Saving…'}
          >
            {creating ? 'Create QR' : 'Save changes'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

'use client';

import { useState, type DragEvent } from 'react';
import { Badge, Button, Field, InlineError, Input, Toggle } from '@ai-review/ui';
import {
  SECTION,
  SECTION_LABEL_MAX,
  SECTION_PHONE_MAX,
  hasStoredTarget,
  isDefaultSectionType,
} from './sections';
import {
  currentOf,
  describePendingChange,
  describeSectionRow,
  storedOf,
  withHttps,
  type EditorSection,
  type SectionEdit,
} from './row-state';

/**
 * One section in PROFILE-01's list: its target, its button text, whether it shows, and where it sits.
 *
 * Reordering has two independent controls on purpose. Drag is the pointer affordance the screen spec
 * names; Move up and Move down are the same operation for anyone using a keyboard or a screen reader.
 * AC-037 requires keyboard operation, and HTML5 drag events are not keyboard-operable at all — no
 * amount of focus styling makes `dragstart` fire from a key press — so a drag-only list is unusable
 * for those users. The buttons are also what make the order legible without sight: each row states
 * its own position in words.
 *
 * There is no star rating and no sentiment control anywhere on this row (D-009, AC-006), and the
 * Review Us section carries no url field of its own (AMENDMENT-003): its destination lives in
 * `review_destinations` and is edited on ONB-02, which is the single-owner property AC-017 needs.
 */

export interface SectionRowProps {
  section: EditorSection;
  index: number;
  total: number;
  /** From `review_destinations`; decides whether the Review Us button has anywhere to go. */
  reviewUrl: string | null;
  /** True while a save is in flight, or when the tenant is suspended or closed (Flow J). */
  disabled: boolean;
  error: { message: string; field: string | null } | null;
  onChange: (id: string, edit: SectionEdit) => void;
  /** Moves the row at `from` to `to`. Both reorder paths end here. */
  onMove: (from: number, to: number) => void;
  onRemove: (id: string) => void;
  /** Pointer reordering: the handle starts the drag, the whole row is a drop target. */
  onDragStart: (index: number) => void;
  onDragEnter: (index: number) => void;
  /**
   * A real drop landed on this row. Reported separately from `onDragEnd` on purpose: `dragend` fires
   * for an abandoned gesture too — Escape mid-drag, or a release outside the list — so only this
   * says the owner actually meant the arrangement they are looking at.
   */
  onDrop: () => void;
  onDragEnd: () => void;
  /** True when this row is the one currently being dragged. */
  isDragging: boolean;
}

export function SectionRow({
  section,
  index,
  total,
  reviewUrl,
  disabled,
  error,
  onChange,
  onMove,
  onRemove,
  onDragStart,
  onDragEnter,
  onDrop,
  onDragEnd,
  isDragging,
}: SectionRowProps) {
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  const descriptor = SECTION[section.type];
  const stored = storedOf(section);
  const badge = describeSectionRow(stored, reviewUrl);
  const pending = describePendingChange(currentOf(section), stored, reviewUrl);

  // PROFILE-01-02, explained before it can be hit. `ck_enabled_link_has_target` would refuse the
  // write and the endpoint refuses it in words; the toggle simply does not offer it, so the owner
  // meets neither.
  const canShow = hasStoredTarget(currentOf(section));
  const removable = !isDefaultSectionType(section.type);

  const targetError = error?.field === 'url' || error?.field === 'phone' ? error.message : null;
  const labelError = error?.field === 'label' ? error.message : null;
  // A failure naming no field — or naming `enabled`, which has no input of its own — belongs to the
  // row as a whole rather than to one box.
  const rowError =
    error !== null && targetError === null && labelError === null ? error.message : null;

  function handleDrop(event: DragEvent<HTMLLIElement>) {
    // The move has already happened on dragenter; this only records that the gesture was completed
    // rather than abandoned, and stops the browser treating the payload as a navigation. `dragend`
    // fires next on the handle and is what finishes the gesture either way.
    event.preventDefault();
    onDrop();
  }

  return (
    <li
      // A drop is refused outright unless dragover cancels the default, so this is not optional.
      onDragOver={(event) => event.preventDefault()}
      onDragEnter={() => onDragEnter(index)}
      onDrop={handleDrop}
      className={[
        'flex flex-col gap-4 rounded-card border bg-bg p-4',
        isDragging ? 'border-accent opacity-60' : 'border-line',
      ].join(' ')}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          {/*
            Decorative and not focusable: dragging is the pointer path and the two buttons are the
            keyboard one. A handle that cannot be operated from a key press would be a dead stop in
            the tab order (AC-037).
          */}
          <span
            draggable={!disabled}
            onDragStart={(event) => {
              // Some browsers cancel a drag that carries no payload.
              event.dataTransfer.setData('text/plain', section.id);
              event.dataTransfer.effectAllowed = 'move';
              onDragStart(index);
            }}
            onDragEnd={onDragEnd}
            aria-hidden="true"
            className={[
              'mt-1 text-lg leading-none text-ink-muted select-none',
              disabled ? 'cursor-not-allowed' : 'cursor-grab',
            ].join(' ')}
          >
            {'⠿'}
          </span>

          <div className="min-w-0">
            <h3 className="text-base font-semibold text-ink">{descriptor.name}</h3>
            {/* The order in words, so it survives a screen reader and a monochrome display. */}
            <p className="text-sm text-ink-muted">
              Position {index + 1} of {total}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={badge.tone}>{badge.label}</Badge>

          {/*
            Neither button is disabled at the ends of the list, and that is deliberate. Disabling the
            control the owner just pressed removes it from the tab order, which drops keyboard focus
            to the top of the document mid-task — the exact failure `Button`'s own docstring calls out
            against AC-037, and it would happen every time a section was moved into first or last
            place. A move past the end is a no-op instead, and the editor announces "already first"
            in its live region so the press is never silent.
          */}
          <Button variant="secondary" disabled={disabled} onClick={() => onMove(index, index - 1)}>
            <span aria-hidden="true">{'↑'}</span>
            <span className="sr-only">Move {descriptor.name} up</span>
          </Button>
          <Button variant="secondary" disabled={disabled} onClick={() => onMove(index, index + 1)}>
            <span aria-hidden="true">{'↓'}</span>
            <span className="sr-only">Move {descriptor.name} down</span>
          </Button>
        </div>
      </div>

      {rowError && <InlineError>{rowError}</InlineError>}

      {section.type === 'GOOGLE_REVIEW' ? (
        <p className="text-sm text-ink-muted">
          {descriptor.hint}{' '}
          <a
            href="#review-location"
            className="font-medium text-accent underline-offset-4 hover:underline"
          >
            Change the location above
          </a>{' '}
          and this button—and every printed QR code—updates at once.
        </p>
      ) : (
        <Field
          label={descriptor.targetLabel}
          hint={targetError === null ? descriptor.hint : undefined}
          error={targetError}
        >
          {(control) =>
            descriptor.target === 'phone' ? (
              <Input
                {...control}
                name={`${section.id}-phone`}
                type="tel"
                inputMode="tel"
                autoComplete="off"
                maxLength={SECTION_PHONE_MAX}
                value={section.phone}
                disabled={disabled}
                onChange={(event) => onChange(section.id, { phone: event.target.value })}
              />
            ) : (
              <Input
                {...control}
                name={`${section.id}-url`}
                type="url"
                inputMode="url"
                autoComplete="off"
                value={section.url}
                disabled={disabled}
                onChange={(event) => onChange(section.id, { url: event.target.value })}
                onBlur={(event) => onChange(section.id, { url: withHttps(event.target.value) })}
              />
            )
          }
        </Field>
      )}

      <Field
        label="Button text"
        hint={labelError === null ? 'What visitors see on the button.' : undefined}
        error={labelError}
      >
        {(control) => (
          <Input
            {...control}
            name={`${section.id}-label`}
            value={section.label}
            maxLength={SECTION_LABEL_MAX}
            disabled={disabled}
            onChange={(event) => onChange(section.id, { label: event.target.value })}
          />
        )}
      </Field>

      <Toggle
        checked={section.enabled}
        // Left operable while it is on, so a section can always be switched off; only turning one on
        // without a target is refused, which is the direction PROFILE-01-02 governs.
        disabled={disabled || (!canShow && !section.enabled)}
        onCheckedChange={(checked) => onChange(section.id, { enabled: checked })}
        label="Show on my page"
        description={
          canShow
            ? undefined
            : 'Add a link above first. A section with nothing to point at cannot be shown.'
        }
      />

      {pending && <p className="text-sm text-ink-muted">{pending}</p>}

      {removable && (
        <div className="border-t border-line pt-3">
          {confirmingRemove ? (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm text-ink">
                Remove {descriptor.name}? You cannot add it back from this screen.
              </p>
              <Button
                variant="destructive"
                disabled={disabled}
                onClick={() => onRemove(section.id)}
              >
                Yes, remove
              </Button>
              <Button variant="text" onClick={() => setConfirmingRemove(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            /*
              Offered only for a section that is not one of the D-014 five. Those five can be hidden
              but never removed — PROFILE-01-01 asserts they exist and V1 has no endpoint that could
              recreate one — and the DELETE handler refuses them for the same reason.
            */
            <Button variant="text" disabled={disabled} onClick={() => setConfirmingRemove(true)}>
              Remove this section
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

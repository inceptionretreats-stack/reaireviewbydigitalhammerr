'use client';

import { useId, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { cx } from '../lib/cx';
import { CONTROL_INVALID, CONTROL_SURFACE, FOCUS_RING, TOUCH_TARGET } from '../lib/tokens';
import {
  addTags,
  DEFAULT_TAG_RULES,
  describeTagRejection,
  removeTagAt,
  type TagRejection,
  type TagRules,
} from '../lib/tags';
import { Button } from './Button';

/**
 * Free-text tag list for the AI context fields (ONB-04 / AI-01: services and context terms,
 * 0-30 each).
 *
 * Note what this component is not. It has no "required term" or "must appear" affordance, and
 * the copy it ships calls the entries terms, never keywords. D-025 and AC-010 are explicit that
 * merchant context is a hint to the model and never mandatory output, and
 * `packages/contracts/src/business.ts` makes the same point about the field's absence from the
 * contract. A UI switch here would be the easiest place for that decision to leak back in.
 *
 * Interaction, in order of how people actually use it: Enter or comma commits, paste splits on
 * commas / newlines / tabs (pasting a column out of a price list is the common case), Backspace
 * on an empty box removes the last term, and an explicit Add button exists because on a phone
 * keyboard the Enter key is frequently a "next field" key instead.
 */

export interface TagInputProps {
  value: readonly string[];
  onChange: (tags: readonly string[]) => void;
  rules?: TagRules;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** Supplied by `Field` via its render prop. */
  id?: string;
  'aria-describedby'?: string | undefined;
  'aria-invalid'?: true | undefined;
  required?: boolean | undefined;
}

export function TagInput({
  value,
  onChange,
  rules = DEFAULT_TAG_RULES,
  placeholder,
  disabled = false,
  className,
  id,
  'aria-describedby': describedBy,
  'aria-invalid': invalid,
  required,
}: TagInputProps) {
  const generatedId = useId();
  const inputId = id ?? `${generatedId}-tag-input`;
  const statusId = `${generatedId}-status`;

  const [draft, setDraft] = useState('');
  const [rejection, setRejection] = useState<TagRejection | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const full = value.length >= rules.maxItems;

  const commit = (raw: string): void => {
    const result = addTags(value, raw, rules);
    setRejection(result.rejection);

    if (result.added) onChange(result.tags);

    // A duplicate is not a mistake to correct — the term is already in the list — so the box is
    // cleared. TOO_LONG and LIST_FULL keep the text so it can be shortened or retried.
    if (result.added || result.rejection === 'DUPLICATE' || result.rejection === 'EMPTY') {
      setDraft('');
    }
  };

  const remove = (index: number): void => {
    onChange(removeTagAt(value, index));
    setRejection(null);
    // Removing a chip destroys the element that had focus, which would otherwise drop the
    // keyboard user back to the top of the document (AC-037).
    inputRef.current?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter' || event.key === ',') {
      // Enter inside a form would otherwise submit the whole page mid-edit.
      event.preventDefault();
      commit(draft);
      return;
    }

    if (event.key === 'Backspace' && draft === '' && value.length > 0) {
      event.preventDefault();
      onChange(removeTagAt(value, value.length - 1));
      setRejection(null);
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLInputElement>): void => {
    const pasted = event.clipboardData.getData('text');
    if (!/[,\n\r\t]/.test(pasted)) return;
    event.preventDefault();
    commit(`${draft}${pasted}`);
  };

  return (
    <div className={cx('flex flex-col gap-2', className)}>
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Added terms">
          {value.map((tag, index) => (
            <li
              key={tag}
              className="inline-flex items-center gap-1 rounded-pill border border-line bg-surface py-1 pr-1 pl-3 text-sm text-ink"
            >
              <span>{tag}</span>
              <button
                type="button"
                disabled={disabled}
                onClick={() => remove(index)}
                // 32px: comfortably over WCAG 2.2 SC 2.5.8's 24px minimum. The design brief's
                // stricter 44px applies to primary controls, which a chip's remove is not.
                className={cx(
                  'inline-flex size-8 items-center justify-center rounded-pill text-ink-muted',
                  'hover:bg-line hover:text-ink disabled:cursor-not-allowed',
                  FOCUS_RING,
                )}
              >
                <span aria-hidden="true">&times;</span>
                <span className="sr-only">Remove {tag}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-2">
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          value={draft}
          placeholder={placeholder}
          disabled={disabled}
          required={required}
          aria-invalid={invalid}
          aria-describedby={cx(describedBy, statusId) || undefined}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onBlur={() => {
            // Committing on blur stops a typed-but-unadded term from being silently lost when
            // the owner tabs straight to Save. Clicking Add also blurs first, but the commit
            // empties the box and so disables Add before the click lands — the term is added
            // once, not twice.
            if (draft.trim() !== '') commit(draft);
          }}
          className={cx(CONTROL_SURFACE, TOUCH_TARGET, CONTROL_INVALID, FOCUS_RING)}
        />
        <Button
          variant="secondary"
          disabled={disabled || full || draft.trim() === ''}
          onClick={() => commit(draft)}
        >
          Add
        </Button>
      </div>

      {/*
        One polite live region for both the count and any rejection. Two regions would race and
        announce in an unpredictable order.
      */}
      <p id={statusId} className="text-sm text-ink-muted" aria-live="polite">
        {rejection ? (
          <span className="text-danger">{describeTagRejection(rejection, rules)}</span>
        ) : (
          `${value.length} of ${rules.maxItems} added. These are hints for the writing assistant, not words it must use.`
        )}
      </p>
    </div>
  );
}

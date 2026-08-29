'use client';

import { useId, type ReactNode } from 'react';
import { cx } from '../lib/cx';
import { InlineError } from './InlineError';

/**
 * Label, hint and error wiring for one form control.
 *
 * `18_UI_UX_Design_System_Brief.md` forbids placeholder-only labels, and AC-037 makes the
 * label/description/error association an acceptance criterion rather than a nicety. Getting
 * that wiring right by hand at every call site is how it stops being done, so `Field` owns it
 * and hands the control the attributes it must carry.
 *
 * The API is a render prop rather than `cloneElement` on `children`. Cloning silently does
 * nothing when the child is wrapped in anything (a `<div>`, a `memo`, a layout component), and
 * it does so without any type error — the field looks correct and ships with no accessible
 * name. Passing the attributes explicitly cannot fail that way, and TypeScript enforces that
 * the control actually accepts them.
 *
 *   <Field label="Business name" hint="Shown on your public page" error={errors.name}>
 *     {(control) => <Input {...control} value={name} onChange={...} />}
 *   </Field>
 */

export interface FieldControlProps {
  id: string;
  'aria-describedby': string | undefined;
  'aria-invalid': true | undefined;
  required: boolean | undefined;
}

export interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  /** Present means invalid: it drives `aria-invalid` as well as the message. */
  error?: string | null;
  required?: boolean;
  /**
   * Hides the label visually but keeps it for assistive technology. For a control whose purpose
   * is already obvious from context (a search box under a "Search" heading) — never as a way of
   * reaching a placeholder-only design.
   */
  labelHidden?: boolean;
  className?: string;
  children: (control: FieldControlProps) => ReactNode;
}

export function Field({
  label,
  hint,
  error,
  required = false,
  labelHidden = false,
  className,
  children,
}: FieldProps) {
  const baseId = useId();
  const id = `${baseId}-control`;
  const hintId = `${baseId}-hint`;
  const errorId = `${baseId}-error`;

  // Error first: when a field has both, the correction is the part the user needs to hear
  // before the guidance, and screen readers announce described-by targets in list order.
  const describedBy = cx(error ? errorId : undefined, hint ? hintId : undefined) || undefined;

  const control: FieldControlProps = {
    id,
    'aria-describedby': describedBy,
    'aria-invalid': error ? true : undefined,
    required: required || undefined,
  };

  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className={cx('text-sm font-medium text-ink', labelHidden && 'sr-only')}>
        {label}
        {required && (
          <>
            <span aria-hidden="true"> *</span>
            <span className="sr-only"> (required)</span>
          </>
        )}
      </label>

      {hint && (
        <p id={hintId} className="text-sm text-ink-muted">
          {hint}
        </p>
      )}

      {children(control)}

      {error && <InlineError id={errorId}>{error}</InlineError>}
    </div>
  );
}

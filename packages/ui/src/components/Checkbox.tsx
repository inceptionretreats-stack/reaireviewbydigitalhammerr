'use client';

import { useId, type ComponentPropsWithRef, type ReactNode } from 'react';
import { cx } from '../lib/cx';
import { FOCUS_RING, TOUCH_TARGET } from '../lib/tokens';
import { InlineError } from './InlineError';

/**
 * Checkbox with its own label.
 *
 * Unlike `Input`, this does not compose with `Field`: a checkbox's label sits after the control
 * and forms part of the clickable target, which `Field`'s label-above layout cannot express. It
 * therefore does the same `aria-describedby` / `aria-invalid` wiring internally.
 *
 * The whole row is 44px tall and the label is part of the hit area, so the control meets the
 * design brief's touch-target minimum even though the box itself is drawn at 20px.
 *
 * `accent-accent` keeps the native checkbox glyph rather than replacing it with a styled div.
 * The native control is the one that survives Windows high-contrast mode and forced colours.
 */

export interface CheckboxProps extends Omit<ComponentPropsWithRef<'input'>, 'type' | 'children'> {
  label: ReactNode;
  description?: ReactNode;
  error?: string | null;
}

export function Checkbox({
  label,
  description,
  error,
  className,
  id: providedId,
  ...rest
}: CheckboxProps) {
  const generatedId = useId();
  const id = providedId ?? `${generatedId}-checkbox`;
  const descriptionId = `${generatedId}-description`;
  const errorId = `${generatedId}-error`;

  const describedBy =
    cx(error ? errorId : undefined, description ? descriptionId : undefined) || undefined;

  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <div className={cx('flex items-start gap-3', TOUCH_TARGET)}>
        <input
          {...rest}
          id={id}
          type="checkbox"
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          className={cx(
            'mt-2.5 size-5 shrink-0 accent-accent',
            'disabled:cursor-not-allowed disabled:opacity-55',
            FOCUS_RING,
          )}
        />
        <label htmlFor={id} className="flex min-h-11 cursor-pointer items-center text-ink">
          {label}
        </label>
      </div>

      {description && (
        <p id={descriptionId} className="pl-8 text-sm text-ink-muted">
          {description}
        </p>
      )}
      {error && <InlineError id={errorId}>{error}</InlineError>}
    </div>
  );
}

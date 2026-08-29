'use client';

import { useId, type ReactNode } from 'react';
import { cx } from '../lib/cx';
import { PEER_FOCUS_RING, TOUCH_TARGET } from '../lib/tokens';

/**
 * On/off switch.
 *
 * Built on a real `<input type="checkbox" role="switch">` with a real `<label>` rather than a
 * `<button role="switch">`. A button cannot be the target of a `<label for>`, so the
 * button-based version has to fall back to `aria-labelledby` — and the design brief's rule is
 * real labels, always.
 *
 * The track is itself a `<label>` so that tapping it toggles the switch with no click handler
 * of our own. It contributes nothing to the accessible name because it contains no text.
 *
 * Controlled-only on purpose: the track and thumb are styled from the `checked` prop in React
 * rather than from a CSS sibling selector (the thumb is a descendant of the track, so Tailwind's
 * `peer-checked:` cannot reach it). An uncontrolled toggle would flip in the DOM while the
 * visual state stayed put, which is the worst of both.
 *
 * The state is not signalled by colour alone: the thumb moves, and `role="switch"` makes it an
 * announced on/off rather than a hue.
 */

export interface ToggleProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  name?: string;
  id?: string;
  className?: string;
}

export function Toggle({
  checked,
  onCheckedChange,
  label,
  description,
  disabled = false,
  name,
  id: providedId,
  className,
}: ToggleProps) {
  const generatedId = useId();
  const id = providedId ?? `${generatedId}-toggle`;
  const descriptionId = `${generatedId}-description`;

  return (
    <div className={cx('flex flex-col gap-1', className)}>
      <div className={cx('flex items-center gap-3', TOUCH_TARGET)}>
        <input
          id={id}
          name={name}
          type="checkbox"
          role="switch"
          className="peer sr-only"
          checked={checked}
          disabled={disabled}
          aria-describedby={description ? descriptionId : undefined}
          onChange={(event) => onCheckedChange(event.target.checked)}
        />
        <label
          htmlFor={id}
          className={cx(
            'inline-flex h-6 w-11 shrink-0 items-center rounded-pill border p-0.5 transition-colors',
            checked ? 'border-transparent bg-accent' : 'border-line-strong bg-surface',
            disabled ? 'cursor-not-allowed opacity-55' : 'cursor-pointer',
            // The visible ring has to live on the track: the input itself is `sr-only`.
            PEER_FOCUS_RING,
          )}
        >
          <span
            className={cx(
              'size-5 rounded-pill bg-bg shadow-sm transition-transform',
              checked ? 'translate-x-5' : 'translate-x-0',
            )}
          />
        </label>
        <label
          htmlFor={id}
          className={cx(
            'flex min-h-11 items-center text-ink',
            disabled ? 'cursor-not-allowed opacity-55' : 'cursor-pointer',
          )}
        >
          {label}
        </label>
      </div>

      {description && (
        <p id={descriptionId} className="pl-14 text-sm text-ink-muted">
          {description}
        </p>
      )}
    </div>
  );
}

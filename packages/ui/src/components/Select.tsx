import type { ComponentPropsWithRef } from 'react';
import { cx } from '../lib/cx';
import { CONTROL_INVALID, CONTROL_SURFACE, FOCUS_RING, TOUCH_TARGET } from '../lib/tokens';

/**
 * Native `<select>`.
 *
 * Deliberately not a custom listbox: the native control gets the platform picker on mobile —
 * which is a 44px-plus target by construction — and correct keyboard and screen-reader
 * behaviour for free. A custom one would have to re-earn all of that to satisfy AC-037.
 *
 * `placeholder` renders a disabled empty option so an unselected required field is visibly
 * unset rather than silently defaulting to whatever happens to be first.
 */

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<ComponentPropsWithRef<'select'>, 'children'> {
  options: readonly SelectOption[];
  placeholder?: string;
}

export function Select({ options, placeholder, className, ...rest }: SelectProps) {
  return (
    <select
      {...rest}
      className={cx(CONTROL_SURFACE, TOUCH_TARGET, CONTROL_INVALID, FOCUS_RING, className)}
    >
      {placeholder !== undefined && (
        <option value="" disabled>
          {placeholder}
        </option>
      )}
      {options.map((option) => (
        <option key={option.value} value={option.value} disabled={option.disabled}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

import type { ComponentPropsWithRef } from 'react';
import { cx } from '../lib/cx';
import { CONTROL_INVALID, CONTROL_SURFACE, FOCUS_RING, TOUCH_TARGET } from '../lib/tokens';

/**
 * Single-line text control. Covers the text / phone / URL inputs the design brief lists — the
 * variation between them is `type` and `inputMode`, which callers pass through.
 *
 * There is no `label` prop by design. Wrap it in `Field`, which is what guarantees a real
 * `<label>` exists; making the label optional here would make a placeholder-only field
 * possible, which `18_UI_UX_Design_System_Brief.md` forbids outright.
 */
export type InputProps = ComponentPropsWithRef<'input'>;

export function Input({ className, ...rest }: InputProps) {
  return (
    <input
      {...rest}
      className={cx(
        'ui-input',
        CONTROL_SURFACE,
        TOUCH_TARGET,
        CONTROL_INVALID,
        FOCUS_RING,
        className,
      )}
    />
  );
}

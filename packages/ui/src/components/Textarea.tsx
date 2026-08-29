import type { ComponentPropsWithRef } from 'react';
import { cx } from '../lib/cx';
import { CONTROL_INVALID, CONTROL_SURFACE, FOCUS_RING } from '../lib/tokens';

/**
 * Multi-line text control. Like `Input`, it carries no label of its own and expects `Field`.
 *
 * Vertical-only resize: a horizontally resizable textarea inside the dashboard's grid can be
 * dragged wider than its column and push the layout sideways on small screens.
 */
export type TextareaProps = ComponentPropsWithRef<'textarea'>;

export function Textarea({ className, rows = 4, ...rest }: TextareaProps) {
  return (
    <textarea
      {...rest}
      rows={rows}
      className={cx(CONTROL_SURFACE, CONTROL_INVALID, FOCUS_RING, 'resize-y', className)}
    />
  );
}

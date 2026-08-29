'use client';

import { DialogShell, type DialogShellProps } from './DialogShell';
import { cx } from '../lib/cx';

/**
 * Edge-anchored dialog for longer CRUD forms, where a modal would either scroll awkwardly or
 * cover the record the owner is editing against.
 *
 * Behaviourally identical to `Modal` — same focus trap, Escape, focus restoration and scroll
 * lock — because the difference between them is presentation, and an accessibility contract that
 * varies by presentation is one that will drift.
 */

export type DrawerProps = Omit<DialogShellProps, 'containerClassName' | 'panelClassName'> & {
  side?: 'right' | 'left';
};

export function Drawer({ side = 'right', className, ...rest }: DrawerProps) {
  return (
    <DialogShell
      {...rest}
      containerClassName={cx('flex', side === 'right' ? 'justify-end' : 'justify-start')}
      panelClassName="h-dvh w-full max-w-md"
      className={className}
    />
  );
}

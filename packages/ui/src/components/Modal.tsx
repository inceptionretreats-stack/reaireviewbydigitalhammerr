'use client';

import { DialogShell, type DialogShellProps } from './DialogShell';
import { cx } from '../lib/cx';

/**
 * Centred dialog for small create/edit forms and confirmations (the design brief's
 * "Drawer/modal for small CRUD").
 *
 * Focus containment, Escape, focus restoration and background scroll locking come from
 * `DialogShell`.
 *
 * On narrow screens it sits at the bottom of the viewport rather than the middle: a centred
 * dialog with the on-screen keyboard open pushes its own fields out of view.
 */

export type ModalProps = Omit<DialogShellProps, 'containerClassName' | 'panelClassName'> & {
  size?: 'sm' | 'md' | 'lg';
};

const SIZE: Record<NonNullable<ModalProps['size']>, string> = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-lg',
  lg: 'sm:max-w-2xl',
};

export function Modal({ size = 'md', className, ...rest }: ModalProps) {
  return (
    <DialogShell
      {...rest}
      containerClassName="flex items-end justify-center p-0 sm:items-center sm:p-4"
      panelClassName={cx(
        'max-h-[92dvh] w-full rounded-t-card sm:max-h-[85dvh] sm:rounded-card',
        SIZE[size],
      )}
      className={className}
    />
  );
}

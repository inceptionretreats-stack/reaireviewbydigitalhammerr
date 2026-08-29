'use client';

import { useId, useRef, type ReactNode, type RefObject } from 'react';
import { cx } from '../lib/cx';
import { FOCUS_RING } from '../lib/tokens';
import { useDialogBehaviour } from '../lib/use-dialog';

/**
 * Shared implementation behind `Modal` and `Drawer`. Internal: not exported from the package.
 *
 * No React portal, deliberately. `createPortal` lives in `react-dom`, which this package does
 * not depend on at runtime (it is a test-only dependency), and a `position: fixed` overlay is
 * sufficient here. The one caveat worth knowing: a `transform`, `filter` or `perspective` on an
 * ancestor creates a containing block that a fixed child is positioned against, so a dialog
 * must not be opened from inside an animating card. Both dialogs are mounted from page-level
 * components in this product.
 *
 * The backdrop is `aria-hidden` and click-to-dismiss is an optional convenience — never the only
 * way out. There is always a labelled close button and Escape (AC-037).
 */

export interface DialogShellProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** Where focus lands on open. Defaults to the first focusable element inside the panel. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  dismissOnBackdrop?: boolean;
  closeLabel?: string;
  containerClassName: string;
  panelClassName: string;
  className?: string;
}

export function DialogShell({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  initialFocusRef,
  dismissOnBackdrop = true,
  closeLabel = 'Close',
  containerClassName,
  panelClassName,
  className,
}: DialogShellProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const descriptionId = `${baseId}-description`;

  const { onKeyDown } = useDialogBehaviour({ open, onClose, panelRef, initialFocusRef });

  if (!open) return null;

  return (
    <div className={cx('fixed inset-0 z-50', containerClassName)}>
      <div
        className="absolute inset-0 bg-black/60"
        aria-hidden="true"
        onClick={dismissOnBackdrop ? onClose : undefined}
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description === undefined ? undefined : descriptionId}
        // Focusable so the trap has somewhere to put focus in a dialog with no controls.
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className={cx(
          'relative flex flex-col bg-bg text-ink shadow-lg outline-none',
          panelClassName,
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line p-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold text-ink">
              {title}
            </h2>
            {description !== undefined && (
              <p id={descriptionId} className="mt-1 text-sm text-ink-muted">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className={cx(
              'inline-flex size-11 shrink-0 items-center justify-center rounded-control',
              'text-ink-muted hover:bg-surface hover:text-ink',
              FOCUS_RING,
            )}
          >
            <span aria-hidden="true">&times;</span>
            <span className="sr-only">{closeLabel}</span>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>

        {footer !== undefined && (
          <div className="flex flex-wrap justify-end gap-2 border-t border-line p-4">{footer}</div>
        )}
      </div>
    </div>
  );
}

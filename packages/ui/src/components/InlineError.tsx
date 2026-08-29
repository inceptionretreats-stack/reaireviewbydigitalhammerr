import type { ReactNode } from 'react';
import { cx } from '../lib/cx';

/**
 * A validation or operation error shown next to the thing that caused it.
 *
 * The warning glyph is not decoration: `18_UI_UX_Design_System_Brief.md` requires that status is
 * never carried by colour alone, and red text on its own is exactly that. It is `aria-hidden`
 * because the `role` already conveys severity to assistive technology.
 *
 * `role="alert"` is the default because an inline error almost always appears in response to
 * something the user just did. Pass `role="status"` for an error that is present on first render
 * (a page-load failure, say), where an assertive interruption would be wrong.
 */

export interface InlineErrorProps {
  id?: string;
  children: ReactNode;
  role?: 'alert' | 'status';
  className?: string;
}

export function InlineError({ id, children, role = 'alert', className }: InlineErrorProps) {
  return (
    <p
      id={id}
      role={role}
      className={cx('flex items-start gap-1.5 text-sm font-medium text-danger', className)}
    >
      <svg
        viewBox="0 0 20 20"
        className="mt-0.5 size-4 shrink-0"
        aria-hidden="true"
        focusable="false"
      >
        <circle cx="10" cy="10" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M10 5.5v5.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <circle cx="10" cy="14.5" r="1.1" fill="currentColor" />
      </svg>
      <span>{children}</span>
    </p>
  );
}

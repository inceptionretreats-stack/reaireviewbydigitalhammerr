'use client';

import type { ComponentPropsWithRef, MouseEvent, ReactNode } from 'react';
import { cx } from '../lib/cx';
import { FOCUS_RING, TOUCH_TARGET } from '../lib/tokens';
import { Spinner } from './Spinner';

/**
 * The four button variants in `18_UI_UX_Design_System_Brief.md`.
 *
 * Two decisions worth stating.
 *
 * 1. `type` defaults to "button". HTML defaults it to "submit", which turns every secondary
 *    action inside a form (Regenerate, Add tag, Cancel) into an accidental submit.
 *
 * 2. `loading` does NOT set the native `disabled` attribute, while `disabled` does. A disabled
 *    element is removed from the tab order, so disabling the button the user just pressed drops
 *    keyboard focus to the top of the document mid-task — the opposite of AC-037. While loading
 *    the button therefore stays focusable and reports `aria-disabled` / `aria-busy`, and clicks
 *    are swallowed here instead.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'destructive' | 'text';

export interface ButtonProps extends ComponentPropsWithRef<'button'> {
  variant?: ButtonVariant;
  /** `md` is the 44px minimum touch target; `lg` is for the single primary action on a screen. */
  size?: 'md' | 'lg';
  loading?: boolean;
  /** Announced while loading. Defaults to a neutral message. */
  loadingLabel?: string;
  fullWidth?: boolean;
  children: ReactNode;
}

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-on-accent border-transparent hover:bg-accent-hover',
  secondary: 'bg-bg text-ink border-line-strong hover:bg-surface',
  destructive: 'bg-danger text-on-danger border-transparent hover:bg-danger-hover',
  text: 'bg-transparent text-accent border-transparent underline-offset-4 hover:underline',
};

const SIZE: Record<NonNullable<ButtonProps['size']>, string> = {
  md: `${TOUCH_TARGET} px-4 text-base`,
  lg: 'min-h-12 px-5 text-base',
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  loadingLabel = 'Working…',
  fullWidth = false,
  type = 'button',
  className,
  children,
  onClick,
  disabled,
  ...rest
}: ButtonProps) {
  const handleClick = (event: MouseEvent<HTMLButtonElement>): void => {
    if (loading) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    onClick?.(event);
  };

  return (
    <button
      {...rest}
      type={type}
      disabled={disabled}
      aria-disabled={loading || disabled ? true : undefined}
      aria-busy={loading || undefined}
      onClick={handleClick}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-control border font-semibold',
        'transition-colors disabled:cursor-not-allowed disabled:opacity-55',
        loading && 'cursor-progress',
        VARIANT[variant],
        SIZE[size],
        fullWidth && 'w-full',
        FOCUS_RING,
        className,
      )}
    >
      {loading && <Spinner size="sm" />}
      {children}
      {/* The label change is announced without the visible text jumping around mid-press. */}
      {loading && <span className="sr-only">{loadingLabel}</span>}
    </button>
  );
}

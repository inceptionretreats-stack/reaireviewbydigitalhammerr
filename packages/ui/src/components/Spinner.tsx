import { cx } from '../lib/cx';

/**
 * Busy indicator.
 *
 * Two modes, and the distinction is the accessible one: given a `label` this is a live status
 * region announcing that something is happening; without one it is decoration sitting next to
 * text that already says so (the `Button` loading state, for instance). A spinner that
 * announces itself twice is worse than one that never announces at all.
 */

export interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  /** Announced to assistive technology. Omit when adjacent text already carries the message. */
  label?: string;
  className?: string;
}

const SIZE: Record<NonNullable<SpinnerProps['size']>, string> = {
  sm: 'size-4',
  md: 'size-5',
  lg: 'size-8',
};

export function Spinner({ size = 'md', label, className }: SpinnerProps) {
  const graphic = (
    <svg
      className={cx('animate-spin', SIZE[size], label ? undefined : className)}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );

  if (!label) return graphic;

  return (
    <span role="status" className={cx('inline-flex items-center gap-2', className)}>
      {graphic}
      <span className="sr-only">{label}</span>
    </span>
  );
}

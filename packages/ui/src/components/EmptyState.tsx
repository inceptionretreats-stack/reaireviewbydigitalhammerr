import type { ReactNode } from 'react';
import { cx } from '../lib/cx';

/**
 * The zero-state for a list or screen.
 *
 * `action` is a single node, not an array: `18_UI_UX_Design_System_Brief.md` asks for empty
 * states with one clear CTA, and a slot that only holds one is the cheapest way to keep it that
 * way. Secondary guidance belongs in `description`.
 */

export interface EmptyStateProps {
  /** Decorative; rendered `aria-hidden`. The title carries the meaning. */
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cx(
        'flex flex-col items-center gap-3 rounded-card border border-dashed border-line',
        'bg-surface px-6 py-10 text-center',
        className,
      )}
    >
      {icon && (
        <span className="text-ink-muted" aria-hidden="true">
          {icon}
        </span>
      )}
      <p className="text-base font-semibold text-ink">{title}</p>
      {description && <p className="max-w-prose text-sm text-ink-muted">{description}</p>}
      {action}
    </div>
  );
}

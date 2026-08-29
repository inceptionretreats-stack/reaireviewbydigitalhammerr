import type { ReactNode } from 'react';
import { cx } from '../lib/cx';

/**
 * Status pill.
 *
 * Every badge carries a glyph and a word, never a colour on its own — the design brief's
 * "do not rely on color alone" rule. The glyph is `aria-hidden`; the word is the label, so the
 * badge reads identically to a screen reader, in monochrome, and to someone who cannot
 * distinguish the two greens.
 *
 * Text and background for each tone were checked against the palette in `styles.css`: the
 * weakest pair is 5.35:1, comfortably over the 4.5:1 that AC-038 requires.
 */

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

export interface BadgeProps {
  tone?: BadgeTone;
  /** Overrides the tone's default glyph. Rendered `aria-hidden`. */
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}

const TONE: Record<BadgeTone, string> = {
  neutral: 'bg-neutral-soft text-ink border-line',
  accent: 'bg-accent-soft text-accent border-accent',
  success: 'bg-success-soft text-success border-success',
  warning: 'bg-warning-soft text-warning border-warning',
  danger: 'bg-danger-soft text-danger border-danger',
};

const TONE_GLYPH: Record<BadgeTone, string> = {
  neutral: '\u25CB',
  accent: '\u25CF',
  success: '\u2713',
  warning: '\u2022\u2022\u2022',
  danger: '\u2715',
};

export function Badge({ tone = 'neutral', icon, children, className }: BadgeProps) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-pill border px-2.5 py-0.5',
        'text-xs font-semibold whitespace-nowrap',
        TONE[tone],
        className,
      )}
    >
      <span aria-hidden="true">{icon ?? TONE_GLYPH[tone]}</span>
      {children}
    </span>
  );
}

/**
 * The three badge families the design brief names, as a closed set.
 *
 * Values match the database enums they come from (`subscription_status` collapsed to the two
 * plan states the business sees, `qr_status` / `domain_status` lifecycle, and
 * `feedback_status`) so a screen cannot invent a fourth feedback state or spell "Disabled" two
 * ways across two tables.
 */
export type PlanStatus = 'FREE' | 'PRO';
export type LifecycleStatus = 'ACTIVE' | 'PENDING' | 'DISABLED';
export type ItemStatus = 'NEW' | 'READ' | 'ARCHIVED';
export type StatusValue = PlanStatus | LifecycleStatus | ItemStatus;

interface StatusPresentation {
  tone: BadgeTone;
  label: string;
  glyph: string;
}

const STATUS: Record<StatusValue, StatusPresentation> = {
  FREE: { tone: 'neutral', label: 'Free', glyph: '\u25CB' },
  PRO: { tone: 'accent', label: 'Pro', glyph: '\u25C6' },
  ACTIVE: { tone: 'success', label: 'Active', glyph: '\u2713' },
  PENDING: { tone: 'warning', label: 'Pending', glyph: '\u2022\u2022\u2022' },
  DISABLED: { tone: 'neutral', label: 'Disabled', glyph: '\u2298' },
  NEW: { tone: 'accent', label: 'New', glyph: '\u25CF' },
  READ: { tone: 'neutral', label: 'Read', glyph: '\u25CB' },
  ARCHIVED: { tone: 'neutral', label: 'Archived', glyph: '\u25AA' },
};

export interface StatusBadgeProps {
  status: StatusValue;
  /** Overrides the default word, for a screen that names the state differently. */
  label?: string;
  className?: string;
}

export function StatusBadge({ status, label, className }: StatusBadgeProps) {
  const presentation = STATUS[status];
  return (
    <Badge tone={presentation.tone} icon={presentation.glyph} className={className}>
      {label ?? presentation.label}
    </Badge>
  );
}

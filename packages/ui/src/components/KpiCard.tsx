import type { ReactNode } from 'react';
import { cx } from '../lib/cx';

/**
 * A single headline metric for the dashboard.
 *
 * Direction and tone are separate props, and that separation is the point. "Up" is not
 * automatically good here: rising private feedback (Flow E) or a rising quota-exhausted count
 * is a problem, while rising Google-open counts is not. Colouring by direction would tell the
 * business the wrong thing on half its own KPIs.
 *
 * The trend is spelled out in words as well as an arrow, so it survives both a monochrome
 * rendering and the design brief's "do not rely on colour alone" rule.
 *
 * Copy note for callers: the metric that counts departures to Google is "Google review page
 * opened" — the platform cannot observe what happens after that (D-028, AC-025).
 */

export type TrendDirection = 'up' | 'down' | 'flat';
export type TrendTone = 'positive' | 'negative' | 'neutral';

export interface KpiTrend {
  direction: TrendDirection;
  /** Read out as-is, e.g. "12% vs last week". */
  label: string;
  tone?: TrendTone;
}

export interface KpiCardProps {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  trend?: KpiTrend;
  className?: string;
}

const ARROW: Record<TrendDirection, string> = { up: '\u2191', down: '\u2193', flat: '\u2192' };
const DIRECTION_WORD: Record<TrendDirection, string> = { up: 'Up', down: 'Down', flat: 'Flat' };
const TREND_TONE: Record<TrendTone, string> = {
  positive: 'text-success',
  negative: 'text-danger',
  neutral: 'text-ink-muted',
};

export function KpiCard({ label, value, hint, trend, className }: KpiCardProps) {
  return (
    <div
      className={cx('ui-kpi-card rounded-card border border-line bg-bg p-4 shadow-sm', className)}
    >
      <dl>
        <dt className="text-sm font-medium text-ink-muted">{label}</dt>
        <dd className="mt-1 text-3xl font-semibold tabular-nums text-ink">{value}</dd>
      </dl>

      {trend && (
        <p className={cx('mt-2 text-sm font-medium', TREND_TONE[trend.tone ?? 'neutral'])}>
          <span aria-hidden="true">{ARROW[trend.direction]} </span>
          <span className="sr-only">{DIRECTION_WORD[trend.direction]}. </span>
          {trend.label}
        </p>
      )}

      {hint && <p className="mt-2 text-sm text-ink-muted">{hint}</p>}
    </div>
  );
}

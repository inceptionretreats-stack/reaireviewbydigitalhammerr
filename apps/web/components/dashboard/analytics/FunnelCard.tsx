import { Card, EmptyState, Table, type TableColumn } from '@ai-review/ui';
import { formatCount, formatPercent } from './format';
import type { FunnelStep, FunnelSummary } from './metrics';

/**
 * AN-01's funnel.
 *
 * Rendered as a table with a bar in the sessions column, rather than as a picture with a table
 * beside it. `18_UI_UX_Design_System_Brief.md` requires a text or table equivalent for every
 * chart, and for five steps the table IS the better chart: every number is real text, it inherits
 * the responsive stacked mode the brief asks for, and there is only one copy of the data to keep
 * consistent. The bars are `aria-hidden` decoration on top of that — they add the visual
 * comparison without becoming the only way to read the value.
 *
 * No charting library. Five rectangles do not justify shipping one to every dashboard page load.
 *
 * ─── WHAT THIS DOES NOT SAY ───────────────────────────────────────────────────────────────────
 *
 * The last row is "Google review page opened" and the summary above it says how many visitors got
 * that far. Neither is a count of reviews left, and there is deliberately no sixth row: D-028 and
 * AC-025 mean the platform's knowledge stops when the customer leaves for Google. The footer says
 * so in plain words, because a funnel invites the reader to assume the last step is the goal
 * completed, and correcting that assumption is cheaper than letting an owner act on it.
 *
 * Drop-off is shown as words and a number, never as a colour: a red cell would be the only signal
 * for the largest drop otherwise, which the brief forbids.
 */

export interface FunnelCardProps {
  funnel: FunnelSummary;
  /** Rendered in the description so a number is attributable to a period (AC-026). */
  rangeLabel: string;
}

export function FunnelCard({ funnel, rangeLabel }: FunnelCardProps) {
  const columns: readonly TableColumn<FunnelStep>[] = [
    {
      key: 'step',
      header: 'Step',
      isRowHeader: true,
      cell: (step) => (
        <span className="flex flex-col gap-0.5">
          <span>{step.label}</span>
          <span className="text-xs font-normal text-ink-muted">{step.description}</span>
        </span>
      ),
    },
    {
      key: 'sessions',
      header: 'Visitor sessions',
      align: 'end',
      cell: (step) => (
        <span className="flex flex-col items-end gap-1">
          <span className="tabular-nums">{formatCount(step.sessions)}</span>
          <StepBar step={step} />
        </span>
      ),
    },
    {
      key: 'share',
      header: 'Share of first step',
      align: 'end',
      cell: (step) => <span className="tabular-nums">{formatPercent(step.shareOfEntry)}</span>,
    },
    {
      key: 'change',
      header: 'Change from previous step',
      mobileLabel: 'Change from previous',
      cell: (step) => <StepChange step={step} />,
    },
  ];

  return (
    <Card
      as="section"
      title="Customer funnel"
      titleAs="h2"
      description={`Unique visitor sessions at each step, ${rangeLabel}.`}
      footer={
        <>
          A session is a browser, not a person (AN-01-02): one customer on two devices counts twice.
          The last step we can see is the Google review page being opened — what happens on Google
          is not visible to us, so nothing here counts reviews.
        </>
      }
    >
      {funnel.isEmpty ? (
        <EmptyState
          title="Nothing recorded in this period"
          description="No scans, page views, drafts or Google openings were recorded for this date range. Try a longer range, or check that your QR codes are on display."
        />
      ) : (
        <>
          <Table
            caption="Customer funnel steps, visitor sessions, share of the first step, and change from the previous step"
            columns={columns}
            rows={funnel.steps}
            rowKey={(step) => step.event}
          />
          <FunnelHeadline funnel={funnel} />
        </>
      )}
    </Card>
  );
}

/**
 * The one sentence an owner actually wants, stated in terms of what was observed.
 *
 * The largest drop is named rather than only shown, because finding it by comparing four
 * percentages is work the screen can do for them — and it is the question AN-01 exists to answer.
 */
function FunnelHeadline({ funnel }: { funnel: FunnelSummary }) {
  const largestDrop =
    funnel.largestDropIndex === null ? null : funnel.steps[funnel.largestDropIndex];

  return (
    <div className="mt-4 flex flex-col gap-1 rounded-card bg-surface p-3 text-sm text-ink">
      <p>
        <strong className="tabular-nums">{formatCount(funnel.reachedGoogleSessions)}</strong> of{' '}
        <strong className="tabular-nums">{formatCount(funnel.entrySessions)}</strong> sessions that
        started at the first step opened your Google review page
        {funnel.reachedGooglePercent === null
          ? '.'
          : ` — ${formatPercent(funnel.reachedGooglePercent)}.`}
      </p>
      {largestDrop && (
        <p className="text-ink-muted">
          The biggest fall is at <strong>{largestDrop.label}</strong>:{' '}
          {formatCount(largestDrop.changeSessions)} fewer sessions than the step before it.
        </p>
      )}
    </div>
  );
}

/**
 * A bar for one step, `aria-hidden` because the number beside it is the accessible value.
 *
 * Width is the share of the first step and is clamped to 100 so a step that gained sessions does
 * not overflow the column — the number and the change column still report the gain honestly, which
 * is where that information belongs.
 */
function StepBar({ step }: { step: FunnelStep }) {
  if (step.shareOfEntry === null || step.sessions === 0) return null;
  const width = Math.max(2, Math.min(100, step.shareOfEntry));

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 100 6"
      preserveAspectRatio="none"
      className="h-1.5 w-24 max-w-full"
    >
      <rect x="0" y="0" width="100" height="6" rx="2" className="fill-neutral-soft" />
      <rect x="0" y="0" width={width} height="6" rx="2" className="fill-accent" />
    </svg>
  );
}

/**
 * Change against the previous step, in words first.
 *
 * `gained` is not an error to hide. Visitors reach the review page from the public profile page or
 * a shared link without scanning a standee, so a later step legitimately exceeds an earlier one;
 * saying "more than the previous step" is the honest description and points at where those
 * visitors came from.
 */
function StepChange({ step }: { step: FunnelStep }) {
  if (step.change === 'entry') {
    return <span className="text-ink-muted">First step</span>;
  }

  if (step.change === 'unchanged') {
    return <span className="text-ink-muted">No change</span>;
  }

  const lost = step.change === 'dropped';
  const magnitude = Math.abs(step.changeSessions);

  return (
    <span className="flex flex-col gap-0.5">
      <span>
        {/* Word before symbol, and no colour used as the sole signal (AC-038). */}
        <span aria-hidden="true">{lost ? '↓ ' : '↑ '}</span>
        {lost ? 'Lost' : 'Gained'} <span className="tabular-nums">{formatCount(magnitude)}</span>
      </span>
      {step.changePercent !== null && (
        <span className="text-xs text-ink-muted tabular-nums">
          {formatPercent(step.changePercent)} of the previous step
        </span>
      )}
    </span>
  );
}

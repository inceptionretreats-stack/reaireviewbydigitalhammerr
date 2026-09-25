import { Card, EmptyState, Table, type TableColumn } from '@ai-review/ui';
import { formatCount, formatDayLabel } from './format';
import {
  toSeries,
  totalOf,
  type ReportedEvent,
  type TrendDay,
  type TrendSeries,
} from '@/lib/analytics/metrics';

/**
 * AN-01's `Daily trend`, as inline SVG with a table equivalent.
 *
 * No charting library, on purpose. Two polylines do not justify adding one to the bundle every
 * dashboard visitor downloads, and a hand-drawn SVG is the only version where the gap handling
 * below is under our control rather than the library's.
 *
 * ─── THE GAP IS THE POINT ─────────────────────────────────────────────────────────────────────
 *
 * A day the nightly rollup has not summarised yet has UNKNOWN counts, not zero. Drawing it as zero
 * would put a cliff to the floor at the right-hand edge of the chart, and an owner would read that
 * as their standees having stopped working. So the line breaks: `TrendDay.pending` becomes a null
 * point, `toSeries` keeps it null, and the path is emitted as separate segments that do not join
 * across it. A pending day is also shaded and counted in the caption, so the absence is stated
 * rather than merely implied.
 *
 * Today is the opposite case: it is real, counted live, and still filling up. It is marked as
 * partial rather than left out, because leaving it out looks like a drop too.
 *
 * ─── ACCESSIBILITY ────────────────────────────────────────────────────────────────────────────
 *
 * The chart carries `role="img"` and a summary label; the numbers live in a `<details>` table
 * underneath, which is the text equivalent `18_UI_UX_Design_System_Brief.md` requires. It is
 * collapsed because ninety rows would bury the rest of the screen, and `<details>` is keyboard
 * operable and announced without any script.
 *
 * The two series are told apart by stroke pattern as well as colour — solid and dashed — with the
 * same patterns repeated in the legend swatches. Colour is never the only difference (AC-038).
 */

export interface TrendCardProps {
  days: readonly TrendDay[];
  /** Rendered in the description so a number is attributable to a period (AC-026). */
  rangeLabel: string;
  timeZone: string;
}

/**
 * The two series worth plotting together: how many visitors opened the review page, and how many
 * of them went on to open Google. Every other reported event is in the table below.
 */
const PLOTTED: readonly { event: ReportedEvent; label: string }[] = [
  { event: 'review_page_view', label: 'Review page opened' },
  // AC-025 / 18_UI_UX_Design_System_Brief.md: this exact wording, and never "submitted".
  { event: 'google_open', label: 'Google review page opened' },
];

/** Columns of the text equivalent, beyond the two plotted series. */
const TABLE_EVENTS: readonly { event: ReportedEvent; label: string; short: string }[] = [
  { event: 'qr_scan', label: 'QR code scanned', short: 'Scans' },
  { event: 'review_page_view', label: 'Review page opened', short: 'Pages' },
  { event: 'ai_generate_success', label: 'Ai draft created', short: 'Drafts' },
  { event: 'review_copy', label: 'Review copied', short: 'Copies' },
  { event: 'google_open', label: 'Google review page opened', short: 'Google opened' },
];

const WIDTH = 720;
const HEIGHT = 200;
const PAD = { top: 14, right: 10, bottom: 26, left: 10 };
const PLOT_WIDTH = WIDTH - PAD.left - PAD.right;
const PLOT_HEIGHT = HEIGHT - PAD.top - PAD.bottom;

interface SeriesStyle {
  /** Tailwind stroke utility, resolved from the palette tokens in `packages/ui/src/styles.css`. */
  readonly stroke: string;
  /** Dash pattern, so the two lines differ by more than colour (AC-038). */
  readonly dash?: string;
}

const SERIES_STYLE: readonly SeriesStyle[] = [
  { stroke: 'stroke-accent' },
  { stroke: 'stroke-success', dash: '7 5' },
];

const FALLBACK_STYLE: SeriesStyle = { stroke: 'stroke-ink-muted', dash: '2 3' };

/** Never undefined, so the drawing code below carries no optional chaining. */
function styleFor(index: number): SeriesStyle {
  return SERIES_STYLE[index] ?? FALLBACK_STYLE;
}

export function TrendCard({ days, rangeLabel, timeZone }: TrendCardProps) {
  const series = PLOTTED.map((plot) => toSeries(days, plot.event, plot.label));
  const yMax = Math.max(...series.map((one) => one.max), 0);
  const pendingCount = days.filter((day) => day.pending).length;
  const knownDays = days.length - pendingCount;

  return (
    <Card
      as="section"
      title="Daily trend"
      titleAs="h2"
      description={`Per day, ${rangeLabel}.`}
      footer={<TrendFooter pendingCount={pendingCount} days={days} timeZone={timeZone} />}
    >
      {knownDays === 0 ? (
        <EmptyState
          title="No days in this range have been summarised yet"
          description="The nightly summary has not covered any day in this range. Today's figures are counted as they happen and appear in the cards above; the daily trend fills in after the next run."
        />
      ) : yMax === 0 ? (
        <EmptyState
          title="Nothing recorded on any day in this range"
          description="There is no shape to draw here — every day we have summarised recorded no review page views and no Google openings. A chart of zeroes would only look like a chart."
        />
      ) : (
        <>
          <TrendPlot days={days} series={series} yMax={yMax} />
          <TrendLegend series={series} yMax={yMax} />
        </>
      )}

      <details className="mt-4">
        <summary className="cursor-pointer rounded text-sm font-medium text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
          Show the daily numbers as a table
        </summary>
        <div className="mt-3">
          <DailyTable days={days} />
        </div>
      </details>
    </Card>
  );
}

function xFor(index: number, count: number): number {
  if (count <= 1) return PAD.left + PLOT_WIDTH / 2;
  return PAD.left + (index / (count - 1)) * PLOT_WIDTH;
}

function yFor(value: number, yMax: number): number {
  if (yMax <= 0) return PAD.top + PLOT_HEIGHT;
  return PAD.top + PLOT_HEIGHT - (value / yMax) * PLOT_HEIGHT;
}

/**
 * The shaded band for one day, clipped to the plot area.
 *
 * A day's point sits at the centre of its band, so the first and last bands would otherwise hang
 * half a band outside the plot and be cut off by the viewBox at one end but not the other — which
 * reads as the shading meaning something different there.
 */
function bandFor(index: number, count: number): { x: number; width: number } {
  const band = PLOT_WIDTH / Math.max(count, 1);
  const left = Math.max(PAD.left, xFor(index, count) - band / 2);
  const right = Math.min(PAD.left + PLOT_WIDTH, xFor(index, count) + band / 2);
  return { x: left, width: Math.max(0, right - left) };
}

/**
 * Splits a series into the runs of consecutive known days.
 *
 * Returning runs rather than one path is what stops the line being drawn across a day whose value
 * we do not have. A run of length one gets a dot instead of a segment, so a single known day
 * between two gaps is still visible.
 */
function runsOf(series: TrendSeries, yMax: number): { paths: string[]; dots: [number, number][] } {
  const paths: string[] = [];
  const dots: [number, number][] = [];
  let current: [number, number][] = [];

  const flush = (): void => {
    if (current.length === 1) {
      const only = current[0];
      if (only) dots.push(only);
    } else if (current.length > 1) {
      paths.push(
        current
          .map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`)
          .join(' '),
      );
    }
    current = [];
  };

  series.points.forEach((point, index) => {
    if (point.value === null) {
      flush();
      return;
    }
    current.push([xFor(index, series.points.length), yFor(point.value, yMax)]);
  });
  flush();

  return { paths, dots };
}

function TrendPlot({
  days,
  series,
  yMax,
}: {
  days: readonly TrendDay[];
  series: readonly TrendSeries[];
  yMax: number;
}) {
  const first = days[0]?.date;
  const last = days[days.length - 1]?.date;

  const summary = series
    .map((one) => `${one.label}: ${formatCount(one.total)} in total, highest day ${one.max}`)
    .join('. ');

  return (
    <div className="overflow-x-auto">
      <svg
        role="img"
        aria-label={`Daily trend from ${first ?? ''} to ${last ?? ''}. ${summary}. The full numbers are in the table below this chart.`}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-auto w-full min-w-80"
      >
        {/* Pending days shaded first, so the bands sit behind the lines rather than over them. */}
        {days.map((day, index) => {
          if (!day.pending) return null;
          const band = bandFor(index, days.length);
          return (
            <rect
              key={`pending-${day.date}`}
              x={band.x}
              y={PAD.top}
              width={band.width}
              height={PLOT_HEIGHT}
              className="fill-neutral-soft"
            />
          );
        })}

        {/* Baseline and the top gridline, with the maximum labelled — a line chart with no scale
            is a shape, not a measurement. */}
        <line
          x1={PAD.left}
          y1={PAD.top + PLOT_HEIGHT}
          x2={PAD.left + PLOT_WIDTH}
          y2={PAD.top + PLOT_HEIGHT}
          className="stroke-line-strong"
          strokeWidth="1"
        />
        <line
          x1={PAD.left}
          y1={PAD.top}
          x2={PAD.left + PLOT_WIDTH}
          y2={PAD.top}
          className="stroke-line"
          strokeWidth="1"
          strokeDasharray="2 4"
        />
        <text x={PAD.left} y={PAD.top - 4} className="fill-ink-muted text-[11px]">
          {formatCount(yMax)}
        </text>
        <text x={PAD.left} y={HEIGHT - 8} className="fill-ink-muted text-[11px]">
          {first ? formatDayLabel(first) : ''}
        </text>
        <text
          x={PAD.left + PLOT_WIDTH}
          y={HEIGHT - 8}
          textAnchor="end"
          className="fill-ink-muted text-[11px]"
        >
          {last ? formatDayLabel(last) : ''}
        </text>

        {series.map((one, seriesIndex) => {
          const style = styleFor(seriesIndex);
          const { paths, dots } = runsOf(one, yMax);

          return (
            <g key={one.event}>
              {paths.map((path) => (
                <path
                  key={path}
                  d={path}
                  fill="none"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray={style.dash}
                  className={style.stroke}
                />
              ))}
              {/* A known day with a gap on either side gets a dot: a one-point run has no line. */}
              {dots.map(([x, y]) => (
                <circle key={`${x}-${y}`} cx={x} cy={y} r="2.5" className={style.stroke} />
              ))}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** Legend with the same dash patterns as the lines, so the key works in monochrome. */
function TrendLegend({ series, yMax }: { series: readonly TrendSeries[]; yMax: number }) {
  return (
    <ul className="m-0 mt-3 flex list-none flex-wrap gap-x-5 gap-y-2 p-0 text-sm">
      {series.map((one, index) => {
        const style = styleFor(index);
        return (
          <li key={one.event} className="flex items-center gap-2">
            {/* Same dash pattern as the line it stands for, so the key survives a monochrome
                print-out and does not depend on telling blue from green. */}
            <svg aria-hidden="true" viewBox="0 0 24 8" className="h-2 w-6">
              <line
                x1="0"
                y1="4"
                x2="24"
                y2="4"
                strokeWidth="2"
                strokeDasharray={style.dash}
                className={style.stroke}
              />
            </svg>
            <span className="text-ink">{one.label}</span>
            <span className="text-ink-muted tabular-nums">
              {formatCount(one.total)} total, peak {formatCount(one.max)} of {formatCount(yMax)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function TrendFooter({
  pendingCount,
  days,
  timeZone,
}: {
  pendingCount: number;
  days: readonly TrendDay[];
  timeZone: string;
}) {
  const hasLiveDay = days.some((day) => day.live);

  return (
    <>
      {/* These are event counts, like the cards at the top of the screen — not the visitor
          sessions the funnel measures. Saying so here stops the same label carrying two bases on
          one screen. */}
      Each figure counts how often something happened, not how many visitors did it, so it can read
      higher than the funnel&rsquo;s figure for the same step. Days are counted in {timeZone}, your
      business timezone.
      {hasLiveDay && ' Today is still in progress and is counted as it happens.'}
      {pendingCount > 0 && (
        <>
          {' '}
          <strong>
            {pendingCount === 1 ? '1 day is' : `${pendingCount} days are`} shaded and left blank
          </strong>{' '}
          because the nightly summary has not covered {pendingCount === 1 ? 'it' : 'them'} yet.
          Blank means we do not know, not zero — the figures appear after the next run.
        </>
      )}
    </>
  );
}

function DailyTable({ days }: { days: readonly TrendDay[] }) {
  const columns: readonly TableColumn<TrendDay>[] = [
    {
      key: 'date',
      header: 'Day',
      isRowHeader: true,
      cell: (day) => (
        <span className="flex flex-col gap-0.5">
          <span>{formatDayLabel(day.date)}</span>
          {day.live && <span className="text-xs font-normal text-ink-muted">Today, so far</span>}
          {day.pending && (
            <span className="text-xs font-normal text-ink-muted">Not summarised yet</span>
          )}
        </span>
      ),
    },
    ...TABLE_EVENTS.map((column): TableColumn<TrendDay> => ({
      key: column.event,
      header: column.short,
      mobileLabel: column.label,
      align: 'end',
      // An em dash, not a zero: the day's counts are genuinely unknown.
      cell: (day) => (
        <span className="tabular-nums">
          {day.pending ? '—' : formatCount(totalOf(day.counts, column.event))}
        </span>
      ),
    })),
  ];

  return (
    <Table
      caption="Daily figures for each funnel step. A dash means the day has not been summarised yet."
      captionVisible
      columns={columns}
      rows={days}
      rowKey={(day) => day.date}
    />
  );
}

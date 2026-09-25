'use client';

// Field takes its children as a RENDER PROP — a function. A function cannot cross the
// server/client boundary, so a Server Component rendering Field throws at request time. This
// file is a plain form with no server-only access, so marking it client is the correct fix
// rather than restructuring Field.
import Link from 'next/link';
import { Button, Card, Field, Input } from '@ai-review/ui';
import {
  addDays,
  formatLocalDate,
  parseLocalDate,
  type AnalyticsRange,
} from '@/lib/analytics/range';
import { formatRangeLabel } from './format';

/**
 * AN-01's `Date range` field and `Filter` button.
 *
 * A Server Component with a plain `<form method="get">`, and that is a deliberate choice rather
 * than an omission. The range lives entirely in the URL, so:
 *
 *  - no `'use client'`, no fetch, no client state — the screen is server-rendered for whatever the
 *    URL says, which is the only place the range needs to exist;
 *  - the browser Back button returns to the previous range, and the URL can be bookmarked or sent
 *    to Digital Hammerr support showing exactly the numbers the owner is asking about;
 *  - it works with JavaScript unavailable or still loading, which is what makes the Filter button
 *    reliable rather than decorative.
 *
 * Both inputs carry a real `<label>` through `Field`. `18_UI_UX_Design_System_Brief.md` forbids
 * placeholder-only labels, and a bare date input is the classic case where the placeholder is the
 * only clue what the box is for.
 *
 * `max` is the tenant's own today, not the browser's. A native picker would otherwise offer
 * tomorrow to anyone whose laptop clock is ahead of the business's timezone (AC-026). Server-side
 * clamping still happens in `resolveAnalyticsRange` — this only stops the picker suggesting a date
 * that will be silently pulled back.
 */

export interface RangeFilterProps {
  range: AnalyticsRange;
  /** Where the form submits. Kept as a prop so the screen owns its own route. */
  action: string;
  /** Set when a submitted range was rejected, so the message sits with the fields. */
  error?: string | null;
}

/** Quick ranges, in days. Anything else is typed into the two date fields. */
const PRESETS: readonly number[] = [7, 30, 90];

export function RangeFilter({ range, action, error = null }: RangeFilterProps) {
  const today = parseLocalDate(range.today);

  return (
    <Card
      as="section"
      title="Date range"
      titleAs="h2"
      description={formatRangeLabel(range.from, range.to, range.timeZone)}
    >
      <form method="get" action={action} className="flex flex-col gap-4">
        <div className="vendor-date-fields flex flex-wrap items-start gap-4">
          <Field label="From" error={error} className="min-w-40 flex-1">
            {(control) => (
              <Input
                {...control}
                type="date"
                name="from"
                defaultValue={range.from}
                max={range.today}
              />
            )}
          </Field>

          <Field label="To" className="min-w-40 flex-1">
            {(control) => (
              <Input {...control} type="date" name="to" defaultValue={range.to} max={range.today} />
            )}
          </Field>

          {/* Aligned to the bottom of the two fields rather than the top of the row. */}
          <div className="flex items-end self-stretch">
            <Button type="submit">Filter</Button>
          </div>
        </div>

        {today && (
          <div className="vendor-date-presets flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
            <span className="text-ink-muted">Quick ranges:</span>
            {PRESETS.map((days) => {
              const from = formatLocalDate(addDays(today, -(days - 1)));
              const isCurrent = range.from === from && range.to === range.today;

              return (
                <Link
                  key={days}
                  href={`${action}?from=${from}&to=${range.today}`}
                  // aria-current so the active preset is announced, not only shown — the design
                  // brief's rule against conveying state by colour alone applies to links too.
                  aria-current={isCurrent ? 'true' : undefined}
                  className={
                    isCurrent
                      ? 'rounded-control bg-accent-soft px-2 py-1 font-bold text-accent no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'
                      : 'rounded-control px-2 py-1 font-medium text-accent underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'
                  }
                >
                  Last {days} days
                </Link>
              );
            })}
          </div>
        )}
      </form>
    </Card>
  );
}

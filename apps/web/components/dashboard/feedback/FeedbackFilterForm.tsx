'use client';

// Field takes its children as a RENDER PROP — a function. A function cannot cross the
// server/client boundary, so a Server Component rendering Field throws at request time. This
// file is a plain form with no server-only access, so marking it client is the correct fix
// rather than restructuring Field.
import Link from 'next/link';
import { Button, Field, Input, Select, type SelectOption } from '@ai-review/ui';
import {
  DEFAULT_FEEDBACK_FILTERS,
  FEEDBACK_SCREEN_PATH,
  feedbackScreenHref,
  isDefaultFilters,
  type FeedbackFilters,
} from './filters';
import { SECONDARY_LINK } from '../link-styles';

/**
 * FB-02's date and status filters.
 *
 * A plain `method="get"` form, not a client component. Three things follow from that, and all three
 * are the reason for it: filtering works with JavaScript disabled or still loading, every filtered
 * view has its own address that a merchant can bookmark or send to Digital Hammerr support, and the
 * back button behaves — a filter is a navigation, so it should be one.
 *
 * Submitting drops any `cursor` in the current URL, because it is not a field in this form. That is
 * correct rather than incidental: a keyset position from the previous filter means nothing under the
 * new one.
 */

export interface FeedbackFilterFormProps {
  filters: FeedbackFilters;
  /** Shown in the hint, because AC-026 makes the zone part of what the date means. */
  timeZone: string;
  /** Today in that zone, so the pickers cannot offer a future date there is nothing in. */
  todayInZone: string;
}

const STATUS_OPTIONS: readonly SelectOption[] = [
  // Wording, not enum names: "Inbox" is the only one of these that is not a database state, and
  // spelling out what it contains is what stops Archive looking like it did nothing.
  { value: 'inbox', label: 'Inbox (new and read)' },
  { value: 'new', label: 'New only' },
  { value: 'read', label: 'Read only' },
  { value: 'archived', label: 'Archived only' },
  { value: 'all', label: 'Everything, including archived' },
];

export function FeedbackFilterForm({ filters, timeZone, todayInZone }: FeedbackFilterFormProps) {
  return (
    <form
      method="get"
      action={FEEDBACK_SCREEN_PATH}
      className="rounded-card border border-line bg-bg p-4 shadow-sm sm:p-5"
    >
      <fieldset className="flex flex-col gap-4">
        {/* Named for assistive technology; the three labels below carry the visible meaning. */}
        <legend className="sr-only">Filter private feedback</legend>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Show">
            {(control) => (
              <Select
                {...control}
                name="status"
                defaultValue={filters.status}
                options={STATUS_OPTIONS}
              />
            )}
          </Field>

          <Field label="From date" hint={`Dates use your business timezone (${timeZone}).`}>
            {(control) => (
              <Input
                {...control}
                type="date"
                name="from"
                defaultValue={filters.from ?? ''}
                max={todayInZone}
              />
            )}
          </Field>

          <Field label="To date">
            {(control) => (
              <Input
                {...control}
                type="date"
                name="to"
                defaultValue={filters.to ?? ''}
                max={todayInZone}
              />
            )}
          </Field>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit">Apply filters</Button>
          {/*
            A link rather than a reset button: clearing is a navigation to the unfiltered address,
            which keeps that view bookmarkable and the browser history honest. Hidden when there is
            nothing to clear, so it never offers a no-op.
          */}
          {!isDefaultFilters(filters) && (
            <Link href={feedbackScreenHref(DEFAULT_FEEDBACK_FILTERS)} className={SECONDARY_LINK}>
              Clear filters
            </Link>
          )}
        </div>
      </fieldset>
    </form>
  );
}

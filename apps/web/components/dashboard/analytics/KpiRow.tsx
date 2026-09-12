import { KpiCard } from '@ai-review/ui';
import { formatCount } from './format';
import { totalOf, type EventTotals, type ReportedEvent } from './metrics';

/**
 * The KPI cards AN-01 and DASH-01 both ask for.
 *
 * ─── THESE CARDS COUNT EVENTS; THE FUNNEL COUNTS SESSIONS ────────────────────────────────────
 *
 * That difference is real and it has to be visible. `loadAnalyticsOverview` builds `totals` with
 * `count()` over `analytics_events` and the funnel with `countDistinct(anonymous_session_id)`, so
 * a customer who scanned twice is 2 here and 1 there. Borrowing the funnel's exact wording for a
 * card would put 47 and 39 under the same phrase on one screen with nothing explaining the gap —
 * which is the failure the module set out to avoid, not a way of avoiding it. So every label here
 * is deliberately count-language ("scans", "opens", "times"), and `BasisNote` below states the
 * difference once, in words, rather than leaving the reader to discover it.
 *
 * The last card still says only that the Google review page was opened — never that a review was
 * left (AC-025, DASH-01-02, D-028), and a lint rule fails the build on the alternative. No card
 * counts reviews, because none can.
 *
 * No `trend` is passed to any card, and that is a deliberate omission rather than an unfinished
 * one: a trend needs a previous period to compare against, which would mean a second full set of
 * queries per page load. An owner can compare periods with the date filter, and an arrow with no
 * comparison behind it would be invented.
 *
 * `ai_generate_failure` is shown only when it is non-zero. It is the one number here that is bad
 * news when it rises, and a permanent "0 failures" card would take a card's worth of space to say
 * nothing.
 */

export interface KpiRowProps {
  totals: EventTotals;
  uniqueVisitorSessions: number;
}

interface KpiDefinition {
  event: ReportedEvent;
  label: string;
  hint: string;
}

const CARDS: readonly KpiDefinition[] = [
  {
    event: 'qr_scan',
    label: 'QR code scans',
    hint: 'Every scan of any of your QR codes, including the same customer scanning twice.',
  },
  {
    event: 'review_page_view',
    label: 'Review page opens',
    hint: 'Every opening, including visitors who arrived by link rather than by scanning.',
  },
  {
    event: 'ai_generate_success',
    label: 'Ai drafts created',
    hint: 'Every draft returned for a customer to read and edit, including repeat attempts.',
  },
  {
    event: 'review_copy',
    label: 'Times a review was copied',
    hint: 'Every copy to the clipboard. One customer can copy more than once.',
  },
  {
    event: 'google_open',
    label: 'Times the Google review page was opened',
    hint: 'The last step we can see. What happens on Google is not visible to us.',
  },
];

export function KpiRow({ totals, uniqueVisitorSessions }: KpiRowProps) {
  const failures = totalOf(totals, 'ai_generate_failure');

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {CARDS.map((card) => (
          <KpiCard
            key={card.event}
            label={card.label}
            value={formatCount(totalOf(totals, card.event))}
            hint={card.hint}
          />
        ))}

        <KpiCard
          // AN-01-02: named as sessions, not visitors or people, and the hint says why in words the
          // owner will actually read.
          label="Unique visitor sessions"
          value={formatCount(uniqueVisitorSessions)}
          hint="A session is one browser, not one person. The same customer on a phone and a laptop counts twice."
        />

        {failures > 0 && (
          <KpiCard
            label="Failed Ai attempts"
            value={formatCount(failures)}
            hint="Customers who asked for a draft and did not get one. They could still open Google directly from your page."
          />
        )}
      </div>

      <BasisNote />
    </div>
  );
}

/**
 * The one sentence that keeps the cards and the funnel from contradicting each other.
 *
 * Without it an owner reads 47 on a card and 39 in the funnel for what looks like the same thing.
 * Stating the basis is cheaper than making the two agree by feeding the cards session figures,
 * which would leave the hints describing scans and copies that are no longer being counted.
 */
function BasisNote() {
  return (
    <p className="max-w-prose text-xs text-ink-muted">
      These cards count how often something happened. The funnel below counts visitor sessions
      instead — one customer who scans twice is two scans here and one session there — so its
      figures read lower for the same step.
    </p>
  );
}

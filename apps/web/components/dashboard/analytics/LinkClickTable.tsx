import { Badge, Card, EmptyState, Table, type TableColumn } from '@ai-review/ui';
import { formatCount, formatPercent } from './format';
import type { LinkClickMetrics } from './queries';

/**
 * AN-01's `Link clicks` — which buttons on the public profile page people actually press.
 *
 * The click rate is per hundred profile views rather than a bare count, because a count alone is
 * unreadable: twelve clicks is good against forty views and poor against four thousand. It is
 * computed here rather than in the query because it is a presentation choice, and because the
 * denominator has to be allowed to be zero without becoming a division by it.
 *
 * Rows the reader has to be able to tell apart, and why each is shown:
 *
 *  - an enabled link with no clicks — a button nobody presses is a finding, so it stays listed;
 *  - a hidden link WITH clicks — D-015 lets the owner hide a section at any time, so it was
 *    visible earlier in the period and dropping it would leave the total unexplainable;
 *  - one aggregate row for clicks that cannot be attributed. `link_id` arrives from the browser, so
 *    the query only ever uses it to look up links this tenant owns; anything else is counted here
 *    without a label. That is AC-003 applied to a join — a deleted link and another tenant's link
 *    must be indistinguishable — and it is why this row names nothing.
 *
 * A hidden link with no clicks is not listed: it could not be clicked, so a zero says nothing.
 *
 * The footer draws one boundary that is easy to get wrong, so it is stated rather than assumed. A
 * GOOGLE_REVIEW section on the public page resolves straight to the external review URL
 * (`app/[slug]/page.tsx`, AMENDMENT-003) and `PublicProfile` records only `profile_link_click` for
 * it. The visitor never loads the review page, so no `review_page_view` and no `google_open` is
 * recorded — `google_open` is emitted in exactly one place, `ReviewFlow.tsx`. These clicks are
 * therefore NOT in the funnel, and telling an owner they were would let them read the funnel's last
 * step as already including every departure to Google when it under-counts them.
 */

export interface LinkClickTableProps {
  links: readonly LinkClickMetrics[];
  profileViews: number;
  isEmpty: boolean;
  /** Rendered in the description so a number is attributable to a period (AC-026). */
  rangeLabel: string;
}

export function LinkClickTable({ links, profileViews, isEmpty, rangeLabel }: LinkClickTableProps) {
  const columns: readonly TableColumn<LinkClickMetrics>[] = [
    {
      key: 'label',
      header: 'Profile link',
      isRowHeader: true,
      cell: (link) => (
        <span className="flex flex-wrap items-center gap-2">
          <span>{link.label}</span>
          {/* Hidden is a word as well as a colour (AC-038), and it explains a low count that would
              otherwise look like disinterest. */}
          {link.isEnabled === false && <Badge tone="neutral">Hidden now</Badge>}
          {link.linkId === null && <Badge tone="warning">Cannot be attributed</Badge>}
        </span>
      ),
    },
    {
      key: 'clicks',
      header: 'Clicks',
      align: 'end',
      cell: (link) => <span className="tabular-nums">{formatCount(link.clicks)}</span>,
    },
    {
      key: 'rate',
      header: 'Click rate',
      mobileLabel: 'Click rate (share of profile views)',
      align: 'end',
      cell: (link) => (
        <span className="tabular-nums">{formatPercent(clickRate(link, profileViews))}</span>
      ),
    },
    {
      key: 'sessions',
      header: 'Visitor sessions',
      mobileLabel: 'Visitor sessions (a browser, not a person)',
      align: 'end',
      cell: (link) => (
        // An em dash on the unattributable row: adding the distinct-session counts of several
        // unknown ids would count one visitor once per link they touched, and an inflated figure
        // is worse than an absent one.
        <span className="tabular-nums">
          {link.visitorSessions === null ? '—' : formatCount(link.visitorSessions)}
        </span>
      ),
    },
  ];

  return (
    <Card
      as="section"
      title="Profile link clicks"
      titleAs="h2"
      description={`Buttons pressed on your public page, ${rangeLabel}.`}
      footer={
        <>
          Measured against {formatCount(profileViews)} {profileViews === 1 ? 'view' : 'views'} of
          your public page in this period. A press of your Google review button here goes straight
          to Google from your public page, so it is counted only in this table — the funnel above
          counts the Google review page being opened from your review page.
        </>
      }
    >
      {isEmpty ? (
        <EmptyState
          title="No link clicks in this period"
          description="Nobody pressed a button on your public page in this date range. If your page is new, share the link with a few customers and check back."
        />
      ) : (
        <Table
          caption="Profile links with clicks, clicks per hundred profile views, and visitor sessions"
          columns={columns}
          rows={links}
          rowKey={(link) => link.linkId ?? 'unattributed'}
        />
      )}
    </Card>
  );
}

/**
 * Clicks as a share of profile views, or null when there were none.
 *
 * Null rather than 0: with no views there is no rate, and printing "0%" would say the button was
 * shown and ignored. It can legitimately exceed 100% — one visitor pressing two buttons, or the
 * same button twice — so it is not clamped.
 */
function clickRate(link: LinkClickMetrics, profileViews: number): number | null {
  if (profileViews <= 0) return null;
  return Math.round((link.clicks / profileViews) * 1000) / 10;
}

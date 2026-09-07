import { Badge, Card, EmptyState, StatusBadge, Table, type TableColumn } from '@ai-review/ui';
import { formatCount } from './format';
import type { QrSourceMetrics } from './queries';

/**
 * AN-01's `QR source table`.
 *
 * Every source the tenant owns is listed, including one that recorded nothing: a standee that got
 * no scans this month is a finding, and omitting it would leave the owner to notice its absence.
 * QR-01 offers disable rather than delete (QR-01-01), so the list is stable between periods and
 * two months can be compared row by row.
 *
 * AN-01 also lists an `Open QR detail` action. There is no link here, because QR-01's detail screen
 * does not exist yet and `components/dashboard/nav-items.ts` sets the precedent for the whole
 * dashboard: a link that 404s teaches an owner the product is broken. The id is in the API response
 * ready for it. Wiring it in is a one-line change once that route lands.
 *
 * AC-025: the last column counts the Google review page being opened. It is not a count of reviews
 * and nothing on this screen turns it into one.
 */

export interface QrSourceTableProps {
  sources: readonly QrSourceMetrics[];
  isEmpty: boolean;
  /** Rendered in the description so a number is attributable to a period (AC-026). */
  rangeLabel: string;
}

export function QrSourceTable({ sources, isEmpty, rangeLabel }: QrSourceTableProps) {
  const columns: readonly TableColumn<QrSourceMetrics>[] = [
    {
      key: 'label',
      header: 'Source',
      isRowHeader: true,
      cell: (source) => (
        <span className="flex flex-wrap items-center gap-2">
          <span>{source.label}</span>
          {/* Status is absent on the two rows that are not QR sources; a neutral badge says which
              so an owner does not go looking for a standee that never existed. */}
          {source.status === null ? (
            <Badge tone="neutral">Not a QR source</Badge>
          ) : (
            <StatusBadge status={source.status} />
          )}
        </span>
      ),
    },
    numeric('scans', 'Scans', 'QR code scanned', (source) => source.scans),
    numeric('pages', 'Review pages', 'Review page opened', (source) => source.reviewPagesOpened),
    numeric('drafts', 'AI drafts', 'AI draft created', (source) => source.draftsCreated),
    numeric('copies', 'Copies', 'Review copied', (source) => source.reviewsCopied),
    numeric(
      'google',
      'Google opened',
      'Google review page opened',
      (source) => source.googlePagesOpened,
    ),
    numeric(
      'sessions',
      'Visitor sessions',
      'Visitor sessions (a browser, not a person)',
      (source) => source.visitorSessions,
    ),
  ];

  return (
    <Card
      as="section"
      title="QR sources"
      titleAs="h2"
      description={`Activity attributed to each QR code, ${rangeLabel}.`}
      footer={
        <>
          Sessions are counted per source, so a customer who scanned two different codes appears
          under both — the rows do not add up to your total visitors. Activity that reached your
          review page from a link rather than a scan is listed separately.
        </>
      }
    >
      {isEmpty ? (
        <EmptyState
          title="No QR activity in this period"
          description="None of your QR codes recorded a scan in this date range. If your standees are on display, try a longer range."
        />
      ) : (
        <Table
          caption="QR sources with scans, review pages opened, AI drafts created, reviews copied, Google review pages opened, and visitor sessions"
          columns={columns}
          rows={sources}
          rowKey={(source) => source.qrCodeId ?? `bucket:${source.label}`}
        />
      )}
    </Card>
  );
}

/**
 * A right-aligned count column.
 *
 * `header` is the short form so seven columns fit a desktop table; `mobileLabel` is the full
 * wording, which is what the stacked mobile mode shows and what a screen reader announces. Both
 * describe an action the platform observed, and the Google column says "opened" in each form —
 * AC-025 and DASH-01-02 rule out the alternative, and the eslint rule fails the build on it.
 */
function numeric(
  key: string,
  header: string,
  mobileLabel: string,
  read: (source: QrSourceMetrics) => number,
): TableColumn<QrSourceMetrics> {
  return {
    key,
    header,
    mobileLabel,
    align: 'end',
    cell: (source) => <span className="tabular-nums">{formatCount(read(source))}</span>,
  };
}

import Link from 'next/link';
import { Card } from '@ai-review/ui';
import { SECONDARY_LINK } from '../link-styles';

/**
 * A direct route to the existing analytics screen, not an invented dashboard chart.
 * This overview does not load analytics totals; the dedicated screen owns its date ranges,
 * recorded events and daily summaries. Link there rather than displaying sample or zero data.
 *
 * The ceiling on what will ever appear is stated up front, deliberately. An owner who expects a
 * count of reviews left on Google will read whatever number appears as that, so the honest version
 * has to be said before the numbers arrive, not after: the last thing this product can observe is
 * that the Google review page was opened (D-028, AC-025, DASH-01-02). What happens on Google is
 * Google's to know.
 */
export function ReportingCard() {
  return (
    <Card
      title="Performance"
      titleAs="h2"
      className="vendor-reporting-card dashboard-section-card dashboard-section-card--green"
      actions={
        <Link href="/app/analytics" className={SECONDARY_LINK}>
          View analytics
        </Link>
      }
    >
      <p className="max-w-prose text-sm leading-relaxed text-ink-muted">
        See recorded scans, Ai drafts and copies, alongside your QR sources and profile link clicks.
        Choose a date range in Analytics to see how customers use your page.
      </p>
      <p className="mt-3 max-w-prose text-sm leading-relaxed text-ink-muted">
        The final step we can report is <strong>Google review page opened</strong> — what a customer
        writes or posts on Google is not something we can see.
      </p>
    </Card>
  );
}

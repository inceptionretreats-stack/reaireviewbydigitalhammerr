import { Card, EmptyState } from '@ai-review/ui';

/**
 * Where DASH-01's funnel, top QR sources and top link clicks will go.
 *
 * An empty state rather than a chart of zeroes. The public flow does record its events already —
 * `POST /api/v1/public/events` writes them — but nothing rolls them up into
 * `analytics_daily_business` yet, so a chart here could only be drawn from numbers this screen
 * does not have. The design brief asks for empty states with one clear message, and "not measured
 * yet" is a different statement from "nobody used it".
 *
 * The ceiling on what will ever appear is stated up front, deliberately. An owner who expects a
 * count of reviews left on Google will read whatever number appears as that, so the honest version
 * has to be said before the numbers arrive, not after: the last thing this product can observe is
 * that the Google review page was opened (D-028, AC-025, DASH-01-02). What happens on Google is
 * Google's to know.
 */
export function ReportingCard() {
  return (
    <Card title="Performance" titleAs="h2">
      <EmptyState
        title="Reporting is not available yet"
        description={
          <>
            Scans, generations and copies are already being recorded, and this is where they get
            summarised, alongside your busiest QR sources and most-used profile links. The final
            step it can ever report is <strong>Google review page opened</strong> — what a customer
            writes on Google is not something we can see.
          </>
        }
      />
    </Card>
  );
}

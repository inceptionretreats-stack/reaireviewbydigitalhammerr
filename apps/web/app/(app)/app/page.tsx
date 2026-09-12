import type { Metadata } from 'next';
import { Suspense } from 'react';
import { DashboardOverview } from '@/components/dashboard/DashboardOverview';
import { DashboardSkeleton } from '@/components/dashboard/DashboardSkeleton';

/**
 * DASH-01 — `/app`.
 *
 * This component awaits nothing on purpose. The tenant's data is fetched inside
 * `DashboardOverview`, behind a Suspense boundary, so the frame and the sidebar are on screen and
 * usable while Postgres is still answering — which is what makes DASH-01's `loading` state a real
 * state rather than a component that is never reached. Awaiting here instead would hold the whole
 * route back and the fallback would never render.
 *
 * What is *not* on this screen, and why, is documented in `components/dashboard/summary.ts`: the
 * KPI cards, funnel, top QR sources, top link clicks and date range all read from an analytics
 * rollup that does not exist yet, and inventing numbers for them would be worse than their absence.
 */

export const metadata: Metadata = {
  title: 'Dashboard | Ai Review',
  description: 'Your public page, QR sources and plan at a glance.',
};

export default function Page() {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <DashboardOverview />
    </Suspense>
  );
}

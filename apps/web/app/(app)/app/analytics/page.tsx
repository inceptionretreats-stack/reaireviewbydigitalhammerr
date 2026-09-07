import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AnalyticsScreen } from '@/components/dashboard/analytics/AnalyticsScreen';
import { AnalyticsSkeleton } from '@/components/dashboard/analytics/AnalyticsSkeleton';

/**
 * AN-01 — `/app/analytics`.
 *
 * The date range lives in the URL rather than in client state. That is what lets this screen be
 * entirely server-rendered with no `'use client'` anywhere in its tree except the shared UI kit
 * primitives: the filter is a plain GET form, so a submitted range is a navigation, the Back
 * button returns to the previous range, and the URL can be sent to support showing exactly the
 * figures being asked about.
 *
 * This component awaits only `searchParams`, never the database. The queries run inside
 * `AnalyticsScreen`, behind the Suspense boundary, so the frame and the sidebar are on screen and
 * usable while Postgres is still answering — which is what makes AN-01's `loading` state a real
 * state rather than a component that is never reached.
 *
 * `key` on the boundary is load-bearing. Without it React reuses the existing subtree when only
 * the search params change, so filtering to a new range would leave the previous range's numbers
 * on screen until the new ones arrived — the one moment where a stale figure is most likely to be
 * read as the new answer.
 */

export const metadata: Metadata = {
  title: 'Analytics | AI Review',
  description: 'Scans, drafts, copies and Google review page openings for your business.',
};

const ROUTE = '/app/analytics';

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const from = firstValue(params.from);
  const to = firstValue(params.to);

  return (
    <Suspense key={`${from ?? ''}:${to ?? ''}`} fallback={<AnalyticsSkeleton />}>
      <AnalyticsScreen from={from} to={to} action={ROUTE} />
    </Suspense>
  );
}

/**
 * A repeated query parameter arrives as an array — `?from=a&from=b` is trivial to produce by hand.
 * The first value is taken rather than the array rejected, because the range is validated
 * downstream anyway and there is no security decision resting on it.
 */
function firstValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

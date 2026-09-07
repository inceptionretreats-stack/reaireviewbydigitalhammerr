import type { Metadata } from 'next';
import { Suspense } from 'react';
import { RequestsSkeleton } from '@/components/dashboard/requests/RequestsSkeleton';
import { ReviewRequestsScreen } from '@/components/dashboard/requests/ReviewRequestsScreen';

/**
 * REQ-01 — `/app/review-requests`.
 *
 * This component awaits nothing on purpose, including `searchParams`: the promise is handed down and
 * awaited inside the screen, behind the Suspense boundary, so the frame and the sidebar are usable
 * while Postgres is still answering. Awaiting here would hold the whole route back and the fallback
 * would never render — the same division `app/(app)/app/page.tsx` makes for DASH-01.
 *
 * The description is worded carefully for the same reason every label on the screen is: this product
 * prepares a message and the owner sends it (D-017, ADR-004, REQ-01-02).
 */

export const metadata: Metadata = {
  title: 'Review requests | AI Review',
  description: 'Prepare a personal review request you send yourself.',
};

export default function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense fallback={<RequestsSkeleton />}>
      <ReviewRequestsScreen searchParams={searchParams} />
    </Suspense>
  );
}

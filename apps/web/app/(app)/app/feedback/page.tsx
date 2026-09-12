import type { Metadata } from 'next';
import { Suspense } from 'react';
import { FeedbackInboxSection } from '@/components/dashboard/feedback/FeedbackInboxSection';
import { FeedbackInboxSkeleton } from '@/components/dashboard/feedback/FeedbackInboxSkeleton';

/**
 * FB-02 — `/app/feedback`.
 *
 * This component awaits nothing, `searchParams` included: the promise is handed down and awaited
 * inside `FeedbackInboxSection`, behind the Suspense boundary. Awaiting it here would hold the whole
 * route back and the fallback would never render, which is how a `loading` state ends up being a
 * component that exists but is never seen.
 *
 * Filters live in the URL rather than in component state, so `?status=archived&from=…` is an address
 * a merchant can bookmark or hand to support, the back button undoes a filter, and the filter form
 * works before any JavaScript has loaded.
 */

export const metadata: Metadata = {
  title: 'Private feedback | Ai Review',
  description: 'Messages your customers sent straight to your business.',
};

export default function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense fallback={<FeedbackInboxSkeleton />}>
      <FeedbackInboxSection searchParams={searchParams} />
    </Suspense>
  );
}

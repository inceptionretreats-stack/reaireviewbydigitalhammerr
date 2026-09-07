/**
 * FB-02's loading state.
 *
 * Real work rather than decoration: `page.tsx` renders it from a Suspense boundary while the tenant
 * and their first page of feedback are fetched, so the dashboard frame and nav stay interactive
 * instead of the whole route waiting on Postgres.
 *
 * The blocks are `aria-hidden` behind a single live region — announcing a dozen placeholder
 * rectangles tells a screen reader user nothing except that something is happening a dozen times.
 * `motion-reduce:animate-none` because a pulsing page is what `prefers-reduced-motion` exists to
 * switch off. Both decisions mirror `components/dashboard/DashboardSkeleton.tsx`.
 */

const BLOCK = 'animate-pulse rounded-card bg-surface motion-reduce:animate-none';

export function FeedbackInboxSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <p role="status" className="sr-only">
        Loading your private feedback.
      </p>

      <div aria-hidden="true" className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <div className={`${BLOCK} h-3 w-24`} />
          <div className={`${BLOCK} h-8 w-64 max-w-full`} />
          <div className={`${BLOCK} h-4 w-full max-w-prose`} />
        </div>

        <div className={`${BLOCK} h-32`} />

        <div className="flex flex-col gap-3">
          <div className={`${BLOCK} h-5 w-72 max-w-full`} />
          <div className={`${BLOCK} h-14`} />
          <div className={`${BLOCK} h-14`} />
          <div className={`${BLOCK} h-14`} />
          <div className={`${BLOCK} h-14`} />
        </div>
      </div>
    </div>
  );
}

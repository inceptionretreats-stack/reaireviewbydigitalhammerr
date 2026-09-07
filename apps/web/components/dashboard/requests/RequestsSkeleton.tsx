/**
 * REQ-01's loading state.
 *
 * Same construction and the same reasons as `components/dashboard/DashboardSkeleton.tsx`: the blocks
 * are `aria-hidden` with one live region for the wait, because announcing five placeholder rectangles
 * tells a screen reader user nothing, and `motion-reduce:animate-none` because a pulsing page is what
 * `prefers-reduced-motion` exists to switch off.
 */

const BLOCK = 'animate-pulse rounded-card bg-surface motion-reduce:animate-none';

export function RequestsSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <p role="status" className="sr-only">
        Loading your review requests.
      </p>

      <div aria-hidden="true" className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <div className={`${BLOCK} h-3 w-28`} />
          <div className={`${BLOCK} h-8 w-72 max-w-full`} />
          <div className={`${BLOCK} h-4 w-full max-w-prose`} />
        </div>

        <div className={`${BLOCK} h-80`} />
        <div className={`${BLOCK} h-48`} />
      </div>
    </div>
  );
}

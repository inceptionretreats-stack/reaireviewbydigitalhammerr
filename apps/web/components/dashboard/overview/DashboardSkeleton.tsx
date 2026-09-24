/**
 * DASH-01's `loading` state.
 *
 * Real work, not decoration: `page.tsx` renders this from a Suspense boundary while the tenant's
 * data is fetched, so the sidebar and the page frame are interactive immediately instead of the
 * whole route waiting on Postgres.
 *
 * The blocks are `aria-hidden` and a single live region announces the wait. Announcing six
 * placeholder rectangles tells a screen reader user nothing except that something is happening six
 * times.
 *
 * `motion-reduce:animate-none` because a pulsing page is exactly what `prefers-reduced-motion`
 * exists to switch off (WCAG 2.2 AA, which AC-038's theme rule sits alongside).
 */

const BLOCK = 'animate-pulse rounded-card bg-surface motion-reduce:animate-none';

export function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <p role="status" className="sr-only">
        Loading your dashboard.
      </p>

      <div aria-hidden="true" className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <div className={`${BLOCK} h-3 w-24`} />
          <div className={`${BLOCK} h-8 w-64 max-w-full`} />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className={`${BLOCK} h-28`} />
          <div className={`${BLOCK} h-28`} />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className={`${BLOCK} h-40`} />
          <div className={`${BLOCK} h-40`} />
        </div>
      </div>
    </div>
  );
}

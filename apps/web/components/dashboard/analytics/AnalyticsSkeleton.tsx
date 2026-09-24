/**
 * AN-01's `loading` state.
 *
 * Real work, not decoration: `page.tsx` renders this from a Suspense boundary while four queries
 * run, so the sidebar and the page frame are interactive immediately instead of the whole route
 * waiting on Postgres. Same pattern and same reasoning as `components/dashboard/overview/DashboardSkeleton`.
 *
 * The blocks are `aria-hidden` and a single live region announces the wait. Announcing eight
 * placeholder rectangles tells a screen reader user nothing except that something is happening
 * eight times.
 *
 * `motion-reduce:animate-none` because a pulsing page is exactly what `prefers-reduced-motion`
 * exists to switch off (WCAG 2.2 AA, alongside AC-038).
 */

const BLOCK = 'animate-pulse rounded-card bg-surface motion-reduce:animate-none';

export function AnalyticsSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <p role="status" className="sr-only">
        Loading your analytics.
      </p>

      <div aria-hidden="true" className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <div className={`${BLOCK} h-3 w-20`} />
          <div className={`${BLOCK} h-8 w-96 max-w-full`} />
          <div className={`${BLOCK} h-4 w-72 max-w-full`} />
        </div>

        {/* The date filter. */}
        <div className={`${BLOCK} h-32`} />

        {/* Six KPI cards. */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className={`${BLOCK} h-28`} />
          <div className={`${BLOCK} h-28`} />
          <div className={`${BLOCK} h-28`} />
          <div className={`${BLOCK} h-28`} />
          <div className={`${BLOCK} h-28`} />
          <div className={`${BLOCK} h-28`} />
        </div>

        {/* Funnel, trend, then the two tables. */}
        <div className={`${BLOCK} h-64`} />
        <div className={`${BLOCK} h-72`} />
        <div className={`${BLOCK} h-56`} />
        <div className={`${BLOCK} h-56`} />
      </div>
    </div>
  );
}

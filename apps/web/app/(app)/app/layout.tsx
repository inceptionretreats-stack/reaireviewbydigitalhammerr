import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { DashboardNav } from '@/components/dashboard/DashboardNav';
import { SignOutButton } from '@/components/dashboard/SignOutButton';
import { getSession } from '@/lib/session';

/**
 * Guard and chrome for the business dashboard.
 *
 * The authoritative session check lives here for the same reason it lives in
 * `app/(app)/onboarding/layout.tsx`: `proxy.ts` runs in the Edge runtime and cannot reach Postgres,
 * so it can see that a cookie exists but not whether the session behind it is live, revoked or
 * expired. A layout is a Server Component, so it can ask, and every page beneath it inherits the
 * answer. A cookie left behind after a revoked session must not render a dashboard.
 *
 * No tenant is resolved here. The nav does not depend on one and each page needs different slices
 * of it, so resolving here as well would be an extra round trip on every request for an answer the
 * chrome never reads.
 *
 * Layout follows the design brief's "desktop-first but responsive": the nav is a wrapping row above
 * the content on a phone and a fixed sidebar from `lg` up, from one list in the DOM rather than two
 * renderings behind breakpoint visibility classes.
 */
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login');

  // A super-admin has no tenant dashboard, and the two consoles are separately guarded (RBAC
  // rule 4). Same redirect the onboarding layout makes.
  if (session.role === 'SUPER_ADMIN') redirect('/admin');

  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      {/*
        The sidebar is thirteen items. Without this, reaching the page content by keyboard means
        tabbing past all of them on every navigation — AC-037 is about keyboard operation being
        workable, not merely possible.
      */}
      <a
        href="#dashboard-content"
        className="sr-only rounded-control bg-accent px-4 py-2 font-semibold text-on-accent focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-10"
      >
        Skip to content
      </a>

      <header className="border-b border-line">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-4">
          <Link
            href="/app"
            className="rounded text-base font-semibold tracking-tight text-ink no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            AI Review <span className="font-normal text-ink-muted">by Digital Hammerr</span>
          </Link>
          <SignOutButton />
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-5 py-6 lg:flex-row lg:gap-8">
        <aside className="lg:w-56 lg:shrink-0">
          <DashboardNav />
        </aside>

        {/* tabIndex -1 so the skip link actually moves focus, not just the scroll position. */}
        <main id="dashboard-content" tabIndex={-1} className="min-w-0 flex-1">
          {children}
        </main>
      </div>
    </div>
  );
}

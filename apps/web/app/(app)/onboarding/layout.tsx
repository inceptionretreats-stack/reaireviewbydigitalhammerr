import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { getSession } from '@/lib/session';

/**
 * Guard and chrome for the onboarding wizard.
 *
 * The authoritative session check lives here rather than in proxy.ts, because proxy runs in the
 * Edge runtime and cannot reach Postgres — it can see that a cookie exists but not whether the
 * session behind it is live, revoked or expired. A layout is a Server Component, so it can, and
 * every page beneath it inherits the check.
 *
 * No tenant is resolved here: each page needs different slices of it, and resolving twice would
 * be two round trips for one answer.
 */
export default async function OnboardingLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login');

  // A super-admin has no tenant to onboard. Sending them to the admin console is better than
  // rendering a wizard against a business they do not own.
  if (session.role === 'SUPER_ADMIN') redirect('/admin');

  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <header className="border-b border-line">
        <div className="mx-auto flex w-full max-w-xl items-center justify-between gap-4 px-5 py-4">
          <Link
            href="/app"
            className="rounded text-base font-semibold tracking-tight text-ink no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            AI Review
          </Link>
          <span className="text-xs text-ink-faint">Setting up your business</span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-xl flex-1 px-5 py-8">{children}</main>
    </div>
  );
}

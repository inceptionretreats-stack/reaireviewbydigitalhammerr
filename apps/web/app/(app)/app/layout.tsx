import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AppBrand } from '@/components/brand/AppBrand';
import { DashboardNav } from '@/components/dashboard/DashboardNav';
import { SignOutButton } from '@/components/dashboard/SignOutButton';
import { getSession } from '@/lib/session';

/** Shared authenticated shell. Pages remain Server Components and inherit this session guard. */
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.role === 'SUPER_ADMIN') redirect('/admin');

  return (
    <div className="app-shell">
      <a
        href="#dashboard-content"
        className="sr-only rounded-control bg-accent px-4 py-2 font-semibold text-on-accent focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50"
      >
        Skip to content
      </a>

      <aside className="app-sidebar">
        <Link href="/app" className="app-sidebar-brand" aria-label="Ai Review dashboard">
          <AppBrand />
        </Link>

        <p className="app-nav-label">Workspace</p>
        <DashboardNav />

        <div className="app-sidebar-note">
          <strong>Turn happy moments into real reviews.</strong>
          <span className="app-mini-signature" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </span>
        </div>
      </aside>

      <div className="app-workspace">
        <header className="app-topbar">
          <div className="app-topbar-copy">
            <span>Business workspace</span>
            <small>Your review experience, all in one place.</small>
          </div>
          <SignOutButton />
        </header>

        <main id="dashboard-content" tabIndex={-1} className="app-main">
          {children}
        </main>

        <footer className="app-footer">
          <span>Ai Review by Digital Hammerr</span>
          <span>Customers always control what they post.</span>
        </footer>
      </div>
    </div>
  );
}

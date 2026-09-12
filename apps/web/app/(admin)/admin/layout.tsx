import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AppBrand } from '@/components/brand/AppBrand';
import { AdminNav } from '@/components/admin/AdminNav';
import { SignOutButton } from '@/components/dashboard/SignOutButton';
import { getSession } from '@/lib/session';

/**
 * The admin shell (19_Admin_Panel_Spec: "Separate admin route and guard").
 *
 * A signed-in owner who lands here is sent to their own workspace, not shown a forbidden page:
 * there is nothing for them to know about this area. The role check is repeated by
 * `requireAdmin` on every API call these pages make; this layout only decides what to render.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.role !== 'SUPER_ADMIN') redirect('/app');

  return (
    <div className="app-shell">
      <a
        href="#admin-content"
        className="sr-only rounded-control bg-accent px-4 py-2 font-semibold text-on-accent focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50"
      >
        Skip to content
      </a>

      <aside className="app-sidebar">
        <Link href="/admin" className="app-sidebar-brand" aria-label="Ai Review admin">
          <AppBrand />
        </Link>
        <p className="app-nav-label">Platform admin</p>
        <AdminNav />
        <div className="app-sidebar-note">
          <strong>Every change here is written to the audit log with your name on it.</strong>
        </div>
      </aside>

      <div className="app-workspace">
        <header className="app-topbar">
          <div className="app-topbar-copy">
            <span>Digital Hammerr — platform admin</span>
            <small>Businesses, plans, Ai prompts and settings.</small>
          </div>
          <SignOutButton />
        </header>

        <main id="admin-content" tabIndex={-1} className="app-main">
          {children}
        </main>

        <footer className="app-footer">
          <span>Ai Review by Digital Hammerr</span>
          <span>Admin actions require a reason and are audited.</span>
        </footer>
      </div>
    </div>
  );
}

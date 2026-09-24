import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AppBrand } from '@/components/shared/AppBrand';
import { AdminNav } from '@/components/admin/AdminNav';
import { SignOutButton } from '@/components/shared/SignOutButton';
import { isAdminRole } from '@ai-review/core';
import { adminMfaRequired, getSession, nextPathAfterLogin } from '@/lib/auth/session';

/**
 * The admin shell (19_Admin_Panel_Spec: "Separate admin route and guard").
 *
 * A signed-in owner who lands here is sent to their own workspace, not shown a forbidden page:
 * there is nothing for them to know about this area. The role check is repeated by
 * `requireAdmin` on every API call these pages make; this layout only decides what to render.
 *
 * AMENDMENT-027: an admin session that has not passed MFA is sent to the challenge (or to
 * enrolment when the account has none). Nothing in this shell renders until it has.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login');
  if (!isAdminRole(session.role)) redirect('/app');
  if (adminMfaRequired() && !session.mfaVerifiedAt) redirect(nextPathAfterLogin(session));

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
        <AdminNav
          role={session.role === 'SUPER_ADMIN' ? 'SUPER_ADMIN' : 'BUSINESS_SUPPORT_VIEWER'}
        />
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

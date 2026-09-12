import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AppBrand } from '@/components/brand/AppBrand';
import { getSession } from '@/lib/session';

/** Authenticated setup shell shared by every onboarding step. */
export default async function OnboardingLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.role === 'SUPER_ADMIN') redirect('/admin');

  return (
    <div className="onboarding-shell">
      <aside className="onboarding-aside">
        <Link href="/" className="onboarding-brand" aria-label="Ai Review home">
          <AppBrand />
        </Link>

        <div className="onboarding-story">
          <h2>Build your review experience, step by step.</h2>
          <p>A focused setup for your business page, Google link and Ai writing help.</p>
        </div>

        <div className="onboarding-aside-footer">
          <span className="app-mini-signature" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </span>
          <p>You can save and return whenever you need.</p>
        </div>
      </aside>

      <div className="onboarding-workspace">
        <header className="onboarding-topbar">
          <span>Setting up your business</span>
          <Link href="/app">Go to dashboard</Link>
        </header>

        <main className="onboarding-main">{children}</main>

        <footer className="onboarding-footer">Ai Review by Digital Hammerr</footer>
      </div>
    </div>
  );
}

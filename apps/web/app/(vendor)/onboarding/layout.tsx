import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AppBrand } from '@/components/shared/AppBrand';
import styles from '@/components/onboarding/VendorOnboarding.module.css';
import { getSession } from '@/lib/auth/session';

/** Authenticated setup shell shared by every onboarding step. */
export default async function OnboardingLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.role === 'SUPER_ADMIN') redirect('/admin');

  return (
    <div className={`onboarding-shell ${styles.shell}`}>
      <aside className={styles.aside}>
        <Link href="/" className={styles.brand} aria-label="Ai Review home">
          <AppBrand />
        </Link>

        <div className={styles.story}>
          <h2>Build your review experience, step by step.</h2>
          <p>A focused setup for your business page, Google link and Ai writing help.</p>
        </div>

        <div className={styles.asideFooter}>
          <span className="app-mini-signature" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </span>
          <p>You can save and return whenever you need.</p>
        </div>
      </aside>

      <div className={styles.workspace}>
        <header className={styles.topbar}>
          <span>Setting up your business</span>
          <Link href="/app">Go to dashboard</Link>
        </header>

        <main className={styles.main}>{children}</main>

        <footer className={styles.footer}>Ai Review by Digital Hammerr</footer>
      </div>
    </div>
  );
}

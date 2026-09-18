import Link from 'next/link';
import type { ReactNode } from 'react';
import { PUBLIC_CONTACT, PUBLIC_INFORMATION_LINKS } from '@/lib/public-information';
import { MarketingShell } from './MarketingSite';
import styles from './PublicInformationPage.module.css';

export function PublicInformationPage({
  title,
  intro,
  path,
  children,
}: {
  title: string;
  intro: string;
  path: string;
  children: ReactNode;
}) {
  return (
    <MarketingShell>
      <div className={styles.page}>
        <nav className={styles.navigation} aria-label="Policies and contact">
          {PUBLIC_INFORMATION_LINKS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={path === item.href ? 'page' : undefined}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <article className={styles.document}>
          <header className={styles.heading}>
            <p className={styles.eyebrow}>Ai Review by Digital Hammerr</p>
            <h1>{title}</h1>
            <p>{intro}</p>
            <p className={styles.updated}>Updated 18 September 2026</p>
          </header>
          <div className={styles.content}>{children}</div>
        </article>
      </div>
    </MarketingShell>
  );
}

export function PublicContactLink({ children = PUBLIC_CONTACT.email }: { children?: ReactNode }) {
  return <a href={`mailto:${PUBLIC_CONTACT.email}`}>{children}</a>;
}

'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import styles from './MarketingSite.module.css';

export type MarketingSectionLink = {
  accent: 'blue' | 'yellow' | 'green';
  href: string;
  id: string;
  label: string;
};

export function MarketingSectionNav({ items }: { items: readonly MarketingSectionLink[] }) {
  const [activeSection, setActiveSection] = useState<string | null>(null);

  useEffect(() => {
    const sections = items
      .map((item) => document.getElementById(item.id))
      .filter((section): section is HTMLElement => section !== null);

    const syncFromHash = () => {
      const hash = window.location.hash.slice(1);
      setActiveSection(items.some((item) => item.id === hash) ? hash : 'home');
    };

    syncFromHash();
    window.addEventListener('hashchange', syncFromHash);

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => right.intersectionRatio - left.intersectionRatio);

        if (visible[0]?.target.id) {
          setActiveSection(visible[0].target.id);
        }
      },
      {
        rootMargin: '-18% 0px -68% 0px',
        threshold: [0, 0.1, 0.35],
      },
    );

    sections.forEach((section) => observer.observe(section));

    return () => {
      observer.disconnect();
      window.removeEventListener('hashchange', syncFromHash);
    };
  }, [items]);

  return (
    <nav className={styles.primaryNav} aria-label="Primary navigation">
      {items.map((item) => (
        <Link
          key={item.id}
          href={item.href}
          className={styles.navLink}
          data-accent={item.accent}
          aria-current={item.id === activeSection ? 'location' : undefined}
          onClick={() => setActiveSection(item.id)}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

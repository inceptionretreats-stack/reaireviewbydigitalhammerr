'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import styles from './MarketingSite.module.css';

export type MarketingSectionLink = {
  accent: 'blue' | 'yellow' | 'green';
  href: string;
  id: string;
  label: string;
};

export function MarketingSectionNav({ items }: { items: readonly MarketingSectionLink[] }) {
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setMenuOpen(false);
      menuButtonRef.current?.focus();
    };
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target)) {
        setMenuOpen(false);
      }
    };
    const closeWhenDesktop = () => setMenuOpen(false);
    const desktop = window.matchMedia('(min-width: 601px)');
    document.addEventListener('keydown', closeOnEscape);
    document.addEventListener('pointerdown', closeOutside);
    desktop.addEventListener('change', closeWhenDesktop);
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      document.removeEventListener('pointerdown', closeOutside);
      desktop.removeEventListener('change', closeWhenDesktop);
    };
  }, [menuOpen]);

  useEffect(() => {
    const sections = items
      .map((item) => document.getElementById(item.id))
      .filter((section): section is HTMLElement => section !== null);

    const syncFromHash = () => {
      const hash = window.location.hash.slice(1);
      setActiveSection(
        items.some((item) => item.id === hash)
          ? hash
          : window.location.pathname.startsWith('/legal/pricing')
            ? 'pricing'
            : window.location.pathname === '/'
              ? 'home'
              : null,
      );
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
    <div className={styles.navigation} ref={menuRef} data-mobile-menu-open={menuOpen}>
      <button
        className={styles.menuButton}
        ref={menuButtonRef}
        type="button"
        aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
        aria-expanded={menuOpen}
        aria-controls="marketing-navigation"
        onClick={() => setMenuOpen((open) => !open)}
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          aria-hidden="true"
        >
          {menuOpen ? <path d="m6 6 12 12M6 18 18 6" /> : <path d="M4 6h16M4 12h16M4 18h16" />}
        </svg>
      </button>
      <nav id="marketing-navigation" className={styles.primaryNav} aria-label="Primary navigation">
        {items.map((item) => (
          <Link
            key={item.id}
            href={item.href}
            className={styles.navLink}
            data-accent={item.accent}
            aria-current={item.id === activeSection ? 'location' : undefined}
            onClick={() => {
              setActiveSection(item.id);
              setMenuOpen(false);
            }}
            onNavigate={(event) => {
              const section = document.getElementById(item.id);
              if (window.location.pathname !== '/' || !section) return;

              event.preventDefault();
              // Next's native history integration retains the route state needed by Back.
              // Scroll explicitly after the menu closes, including repeated hash visits.
              if (window.location.hash !== `#${item.id}`) {
                window.history.pushState(null, '', item.href);
              }
              window.requestAnimationFrame(() => section.scrollIntoView({ block: 'start' }));
            }}
          >
            {item.label}
          </Link>
        ))}
        <Link href="/login" className={styles.mobileSignIn} onClick={() => setMenuOpen(false)}>
          Sign in
        </Link>
      </nav>
    </div>
  );
}

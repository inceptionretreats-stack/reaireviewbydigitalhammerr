'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Badge } from '@ai-review/ui';
import { DASHBOARD_NAV, isCurrentNavItem } from './nav-items';

const ITEM =
  'dashboard-nav-item flex min-h-11 items-center gap-3 rounded-control px-3 text-sm no-underline';
const LINK = `${ITEM} font-medium text-ink hover:bg-surface`;
const CURRENT = `${ITEM} dashboard-nav-item--current font-bold text-accent`;
const PLANNED = `${ITEM} dashboard-nav-item--planned text-ink-muted`;
const TONES = ['nav-tone-blue', 'nav-tone-red', 'nav-tone-yellow', 'nav-tone-green'] as const;

const ICONS: Readonly<Record<string, ReactNode>> = {
  Dashboard: (
    <>
      <path d="M3 11.5 12 4l9 7.5" />
      <path d="M5.5 10.5V20h13v-9.5M9.5 20v-6h5v6" />
    </>
  ),
  'Ai Review': (
    <>
      <path d="m12 3 1.4 3.6L17 8l-3.6 1.4L12 13l-1.4-3.6L7 8l3.6-1.4L12 3Z" />
      <path d="m18.5 14 .8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z" />
      <path d="M4.5 14.5 5.2 16l1.5.7-1.5.7-.7 1.6-.7-1.6-1.5-.7 1.5-.7.7-1.5Z" />
    </>
  ),
  'Review Modes': (
    <>
      <path d="M4 6h16M4 12h16M4 18h16" />
      <circle cx="9" cy="6" r="1.7" />
      <circle cx="15" cy="12" r="1.7" />
      <circle cx="11" cy="18" r="1.7" />
    </>
  ),
  'QR Codes': (
    <>
      <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4z" />
      <path d="M15 14h2v2h-2zM18 17h2v3h-3M13 18v2h2" />
    </>
  ),
  'Business Profile': (
    <>
      <path d="M4 9h16l-1.5-5h-13L4 9Z" />
      <path d="M5 9v11h14V9M9 20v-6h6v6" />
      <path d="M4 9c0 2 3 2 4 0 1 2 3 2 4 0 1 2 3 2 4 0 1 2 4 2 4 0" />
    </>
  ),
  Customers: (
    <>
      <circle cx="9" cy="8" r="3" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M3.5 20c.4-4 2.2-6 5.5-6s5.1 2 5.5 6M14.5 15c3.6-.8 5.8 1 6 5" />
    </>
  ),
  'Review Requests': (
    <>
      <path d="m3 11 18-8-7.5 18-2-7.5L3 11Z" />
      <path d="m11.5 13.5 5-5" />
    </>
  ),
  'Private Feedback': (
    <>
      <path d="M4 5h16v12H9l-5 4V5Z" />
      <path d="M8 9h8M8 13h5" />
    </>
  ),
  Analytics: (
    <>
      <path d="M4 20V10h4v10M10 20V4h4v16M16 20v-7h4v7" />
      <path d="M3 20h18" />
    </>
  ),
  'Custom Domain': (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" />
    </>
  ),
  Subscription: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 9h18M7 15h4" />
    </>
  ),
  Settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" />
      <circle cx="12" cy="12" r="7" />
    </>
  ),
  Support: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.7 9a2.5 2.5 0 1 1 3.7 2.2c-1 .5-1.4 1-1.4 2.3M12 17.5h.01" />
    </>
  ),
};

export function DashboardNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    const closeFromOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !navRef.current?.contains(event.target)) setOpen(false);
    };
    const closeFromKeyboard = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      toggleRef.current?.focus();
    };

    document.addEventListener('pointerdown', closeFromOutside);
    document.addEventListener('keydown', closeFromKeyboard);
    return () => {
      document.removeEventListener('pointerdown', closeFromOutside);
      document.removeEventListener('keydown', closeFromKeyboard);
    };
  }, [open]);

  return (
    <nav
      ref={navRef}
      className={`dashboard-nav${open ? ' dashboard-nav--open' : ''}`}
      aria-label="Dashboard sections"
    >
      <button
        ref={toggleRef}
        type="button"
        className="dashboard-nav-toggle"
        aria-controls="dashboard-navigation"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span>Menu</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          {open ? <path d="m6 6 12 12M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
        </svg>
      </button>

      <ul id="dashboard-navigation" className="dashboard-nav-list">
        {DASHBOARD_NAV.map((item, index) => {
          const tone = TONES[index % TONES.length] ?? TONES[0];
          const startsPlannedGroup = item.label === 'Custom Domain';

          if (item.href === undefined) {
            return (
              <li
                key={item.label}
                className={`${tone}${startsPlannedGroup ? ' dashboard-nav-planned-start' : ''}`}
              >
                <span className={PLANNED}>
                  <NavIcon>{ICONS[item.label]}</NavIcon>
                  <span className="dashboard-nav-text">{item.label}</span>
                  <Badge tone="neutral">Soon</Badge>
                </span>
              </li>
            );
          }

          const current = isCurrentNavItem(pathname, item.href);
          return (
            <li key={item.label} className={tone}>
              <Link
                href={item.href}
                aria-current={current ? 'page' : undefined}
                className={current ? CURRENT : LINK}
                onClick={() => setOpen(false)}
              >
                <NavIcon>{ICONS[item.label]}</NavIcon>
                <span className="dashboard-nav-text">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function NavIcon({ children }: { children: ReactNode }) {
  return (
    <span className="dashboard-nav-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        {children}
      </svg>
    </span>
  );
}

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * The admin area's navigation. Screens are the four in 03_Screen_Field_Button_Spec (ADMIN-01
 * to ADMIN-04) plus the audit explorer E12-07 lists; every one of them exists, so unlike the
 * owner nav there is nothing to mark as planned.
 */
export const ADMIN_NAV = [
  { label: 'Overview', href: '/admin', screen: 'ADMIN-01' },
  { label: 'Businesses', href: '/admin/businesses', screen: 'ADMIN-02' },
  { label: 'Ai prompts', href: '/admin/ai', screen: 'ADMIN-03' },
  { label: 'Platform settings', href: '/admin/settings', screen: 'ADMIN-04' },
  { label: 'Audit log', href: '/admin/audit', screen: 'E12-07' },
] as const;

const ITEM =
  'dashboard-nav-item flex min-h-11 items-center gap-3 rounded-control px-3 text-sm no-underline';

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Admin" className="dashboard-nav dashboard-nav--open">
      <ul className="dashboard-nav-list">
        {ADMIN_NAV.map((item) => {
          const current =
            item.href === '/admin' ? pathname === '/admin' : pathname.startsWith(item.href);
          return (
            <li key={item.href} className="nav-tone-blue">
              <Link
                href={item.href}
                aria-current={current ? 'page' : undefined}
                className={`${ITEM} ${current ? 'dashboard-nav-item--current font-bold text-accent' : 'font-medium text-ink hover:bg-surface'}`}
              >
                <span className="dashboard-nav-text">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * The admin area's navigation. The four screens in 03_Screen_Field_Button_Spec (ADMIN-01 to
 * ADMIN-04), the audit explorer E12-07 lists, and the three CHANGE-004/AMENDMENT-027..030
 * additions: Payments, Team and Activity.
 *
 * A support viewer (05_RBAC) sees only what they may read: no Ai prompts (the system prompt
 * is super-admin only), no platform settings, no team. The pages behind those items redirect a
 * viewer as well; the nav merely stops offering them.
 */
export type AdminNavRole = 'SUPER_ADMIN' | 'BUSINESS_SUPPORT_VIEWER';

export const ADMIN_NAV = [
  { label: 'Overview', href: '/admin', screen: 'ADMIN-01', viewer: true },
  { label: 'Businesses', href: '/admin/businesses', screen: 'ADMIN-02', viewer: true },
  { label: 'Payments', href: '/admin/payments', screen: '19 Payments', viewer: true },
  { label: 'Activity', href: '/admin/activity', screen: 'AMENDMENT-028', viewer: true },
  { label: 'Ai prompts', href: '/admin/ai', screen: 'ADMIN-03', viewer: false },
  { label: 'Platform settings', href: '/admin/settings', screen: 'ADMIN-04', viewer: false },
  { label: 'Team', href: '/admin/team', screen: 'AMENDMENT-027', viewer: false },
  { label: 'Audit log', href: '/admin/audit', screen: 'E12-07', viewer: true },
] as const;

const ITEM =
  'dashboard-nav-item flex min-h-11 items-center gap-3 rounded-control px-3 text-sm no-underline';

export function AdminNav({ role = 'SUPER_ADMIN' }: { role?: AdminNavRole }) {
  const pathname = usePathname();
  const items = ADMIN_NAV.filter((item) => role === 'SUPER_ADMIN' || item.viewer);
  return (
    <nav aria-label="Admin" className="dashboard-nav dashboard-nav--open">
      <ul className="dashboard-nav-list">
        {items.map((item) => {
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

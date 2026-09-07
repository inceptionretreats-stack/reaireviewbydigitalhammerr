'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Badge } from '@ai-review/ui';
import { DASHBOARD_NAV, isCurrentNavItem } from './nav-items';

/**
 * The sidebar navigation from `18_UI_UX_Design_System_Brief.md`.
 *
 * A Client Component for one reason: marking the current page needs the pathname. That is worth a
 * client boundary rather than threading the active item down from every page, because the layout
 * renders once and a page that forgot to declare which nav item it is would show no current item
 * at all.
 *
 * Screens that do not exist yet render as plain text with a "Soon" badge, not as links. A nav item
 * that 404s is indistinguishable from a broken product, and the honest version costs nothing. The
 * unbuilt items are also not focusable, so a keyboard user tabs through what they can actually
 * reach rather than stopping on every item that goes nowhere (AC-037). Stated without a count on
 * purpose: the number of unbuilt screens changes with every screen that ships.
 *
 * The current item is marked three ways — `aria-current="page"`, a heavier weight, and a filled
 * background — so it survives a screen reader, a monochrome display and the design brief's rule
 * against conveying state by colour alone.
 *
 * Layout: a wrapping row of items on small screens and a column from `lg` up. Same markup and one
 * list, so the brief's "desktop-first but responsive" does not become two navigations that a
 * screen reader reads twice.
 */

const ITEM = 'flex min-h-11 items-center justify-between gap-2 rounded-control px-3 text-sm';

const LINK =
  `${ITEM} font-medium text-ink no-underline hover:bg-surface ` +
  'focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-accent';

const CURRENT =
  `${ITEM} bg-accent-soft font-bold text-accent no-underline ` +
  'focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-accent';

const PLANNED = `${ITEM} text-ink-muted`;

export function DashboardNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Dashboard sections">
      <ul className="m-0 flex list-none flex-wrap gap-1 p-0 lg:flex-col lg:flex-nowrap">
        {DASHBOARD_NAV.map((item) => {
          if (item.href === undefined) {
            return (
              <li key={item.label}>
                <span className={PLANNED}>
                  {item.label}
                  <Badge tone="neutral">Soon</Badge>
                </span>
              </li>
            );
          }

          const current = isCurrentNavItem(pathname, item.href);
          return (
            <li key={item.label}>
              <Link
                href={item.href}
                aria-current={current ? 'page' : undefined}
                className={current ? CURRENT : LINK}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

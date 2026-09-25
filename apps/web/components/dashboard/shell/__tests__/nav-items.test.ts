import { describe, expect, it } from 'vitest';
import { DASHBOARD_NAV, isCurrentNavItem } from '../nav-items';

/**
 * `isCurrentNavItem` carries the one edge case in the nav — `/app` is the prefix of every other
 * dashboard route, so a plain prefix test marks Dashboard as current on every screen and the
 * sidebar then shows two current items at once, which is exactly the state AC-037's `aria-current`
 * is meant to disambiguate.
 */

describe('isCurrentNavItem', () => {
  it('matches /app exactly, so Dashboard is not current on every nested screen', () => {
    expect(isCurrentNavItem('/app', '/app')).toBe(true);
    expect(isCurrentNavItem('/app/qr', '/app')).toBe(false);
    expect(isCurrentNavItem('/app/qr/123', '/app')).toBe(false);
  });

  it('matches a section and its detail routes', () => {
    // A detail route such as /app/qr/{id} still belongs to QR Codes.
    expect(isCurrentNavItem('/app/qr', '/app/qr')).toBe(true);
    expect(isCurrentNavItem('/app/qr/123', '/app/qr')).toBe(true);
  });

  it('does not match a sibling that merely shares a prefix', () => {
    // Without the '/' in the prefix test, /app/qr would light up for an /app/qr-archive screen.
    expect(isCurrentNavItem('/app/qr-archive', '/app/qr')).toBe(false);
    expect(isCurrentNavItem('/app/profiles', '/app/profile')).toBe(false);
  });

  it('marks exactly one item current for any dashboard path', () => {
    const paths = ['/app', '/app/qr', '/app/qr/123', '/app/analytics', '/app/settings'];
    for (const path of paths) {
      const current = DASHBOARD_NAV.filter(
        (item) => item.href !== undefined && isCurrentNavItem(path, item.href),
      );
      expect(current, `expected one current item for ${path}`).toHaveLength(1);
    }
  });
});

describe('DASHBOARD_NAV', () => {
  it('retains all eleven built vendor destinations in their grouped display order', () => {
    const built = DASHBOARD_NAV.filter((item) => item.href !== undefined);
    expect(built.map(({ label, href }) => ({ label, href }))).toEqual([
      { label: 'Dashboard', href: '/app' },
      { label: 'Ai Review', href: '/app/ai-review' },
      { label: 'Review Modes', href: '/app/review-modes' },
      { label: 'QR Codes', href: '/app/qr' },
      { label: 'Business Profile', href: '/app/profile' },
      { label: 'Customers', href: '/app/customers' },
      { label: 'Review Requests', href: '/app/review-requests' },
      { label: 'Private Feedback', href: '/app/feedback' },
      { label: 'Analytics', href: '/app/analytics' },
      { label: 'Subscription', href: '/app/subscription' },
      { label: 'Settings', href: '/app/settings' },
    ]);
    for (const item of built) {
      for (const pathname of [
        item.href!,
        ...(item.href === '/app' ? [] : [`${item.href}/detail`]),
      ]) {
        expect(built.filter((candidate) => isCurrentNavItem(pathname, candidate.href!))).toEqual([
          item,
        ]);
      }
    }
  });

  it('gives every built item an href under /app and leaves planned items without one', () => {
    for (const item of DASHBOARD_NAV) {
      if (item.href === undefined) continue;
      expect(item.href).toMatch(/^\/app(\/[a-z-]+)?$/u);
    }
    // A planned item must have nothing to hand to <Link>, which is what stops the nav rendering a
    // link that 404s.
    expect(DASHBOARD_NAV.some((item) => item.href === undefined)).toBe(true);
  });

  it('has no duplicate labels or hrefs, since both are React keys or targets', () => {
    const labels = DASHBOARD_NAV.map((item) => item.label);
    expect(new Set(labels).size).toBe(labels.length);

    const hrefs = DASHBOARD_NAV.flatMap((item) => (item.href === undefined ? [] : [item.href]));
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});

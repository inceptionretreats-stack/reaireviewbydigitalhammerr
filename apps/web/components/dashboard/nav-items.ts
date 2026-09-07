/**
 * The business dashboard's navigation.
 *
 * Order and labels are taken verbatim from the "Business dashboard nav" list in
 * `18_UI_UX_Design_System_Brief.md`; routes come from `03_Screen_Field_Button_Spec.md`, so a link
 * written today cannot disagree with the screen that eventually answers it.
 *
 * `href` is absent until that screen actually exists, and that is a product decision rather than
 * a placeholder: eleven links that 404 teach an owner that the product is broken, whereas an item
 * marked plainly as not available yet is merely unfinished. Modelling it as an optional property
 * also means a planned item has nothing to hand to `<Link>`, so the rendered state cannot drift
 * away from the truth of which routes are built.
 */

export interface DashboardNavItem {
  label: string;
  /** Screen id in `03_Screen_Field_Button_Spec.md`, or null where the pack specifies no screen. */
  screen: string | null;
  /** Set only once the route is built. Absent means "planned", and renders as such. */
  href?: string;
}

export const DASHBOARD_NAV: readonly DashboardNavItem[] = [
  { label: 'Dashboard', screen: 'DASH-01', href: '/app' },
  { label: 'AI Review', screen: 'AI-01' },
  { label: 'Review Modes', screen: 'AI-02' },
  { label: 'QR Codes', screen: 'QR-01' },
  { label: 'Business Profile', screen: 'PROFILE-01' },
  { label: 'Customers', screen: 'CRM-01' },
  { label: 'Review Requests', screen: 'REQ-01' },
  { label: 'Private Feedback', screen: 'FB-02' },
  { label: 'Analytics', screen: 'AN-01' },
  { label: 'Custom Domain', screen: 'DOM-01' },
  { label: 'Subscription', screen: 'SUB-01' },
  { label: 'Settings', screen: 'SET-01' },
  // The brief lists Support in the nav but the screen spec defines no screen for it, so there is
  // no route to be wrong about yet. Recorded here rather than dropped, so the gap stays visible.
  { label: 'Support', screen: null },
];

/**
 * Whether a nav item is the page being viewed.
 *
 * `/app` needs an exact match: every other dashboard route is nested under it, so a prefix test
 * would leave Dashboard marked as current on all thirteen screens. Deeper items do take the
 * prefix, because a detail route such as `/app/qr/{id}` still belongs to QR Codes.
 */
export function isCurrentNavItem(pathname: string, href: string): boolean {
  if (href === '/app') return pathname === '/app';
  return pathname === href || pathname.startsWith(`${href}/`);
}

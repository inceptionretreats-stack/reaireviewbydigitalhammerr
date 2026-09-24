import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { TenantGuard } from '@ai-review/core';
import { parseListQuery } from '@/lib/crm/customers/query';
import { loadCustomerPage } from '@/lib/crm/customers/repository';
import { CustomersScreen } from '@/components/dashboard/customers/CustomersScreen';
import { db } from '@/lib/infra/db';
import { getSession } from '@/lib/auth/session';

export const metadata: Metadata = {
  title: 'Customers | Ai Review',
  description: 'The people you can ask for a review, one at a time.',
};

/**
 * CRM-01 — `/app/customers`.
 *
 * A Server Component that reads the first page and hands it to the screen, rather than letting the
 * browser fetch it on mount. The same reasoning as `/onboarding/business`: an owner who opens this
 * from the nav would otherwise watch an empty table fill in, and could type a search into a list that
 * is about to be replaced under them.
 *
 * The query runs here through the endpoint's own loader instead of calling `GET /api/v1/customers`.
 * Invoking a route handler from a Server Component costs an extra HTTP hop and would have to forward
 * this request's cookies to authenticate; the tenant is already resolved here. Sharing the loader
 * rather than the query is what keeps the two from drifting — one `WHERE business_id = … AND
 * deleted_at IS NULL`, in one place (AC-003, AC-040).
 *
 * Search and pagination are *not* read from `searchParams`, so this always renders the unfiltered
 * first page. Once mounted, the screen owns that state and does not write it back to the URL, and a
 * server that seeded from the URL while the client never updated it would produce a back button that
 * silently disagrees with the table. Deep-linking a search is recorded in the concerns rather than
 * half-built.
 */
export default async function Page() {
  const session = await getSession();
  // The layout has already redirected an anonymous caller. Repeated because this page reads tenant
  // data and must not depend on a parent's guard for that; it also narrows the type.
  if (!session) redirect('/login');

  const database = db();
  const tenant = await new TenantGuard(database).resolveActive(session);

  /*
   * A live session with no business behind it. `/app` is the one screen that explains that state —
   * see `DashboardOverview` — and it renders rather than redirecting, so this cannot loop. The role it
   * legitimately happens to is BUSINESS_SUPPORT_VIEWER, which owns no business by design; duplicating
   * the explanation here would give the same person two different accounts of the same thing.
   */
  if (!tenant.ok) redirect('/app');

  // The defaults the endpoint applies to a request with no parameters, taken from the endpoint so
  // that the first page the owner sees is the first page `GET /customers` would return.
  const query = parseListQuery(new URLSearchParams());
  const initial = await loadCustomerPage(database, tenant.businessId, query);

  return <CustomersScreen initial={initial} />;
}

import { redirect } from 'next/navigation';
import { SlugService, TenantGuard } from '@ai-review/core';
import { Card, InlineError } from '@ai-review/ui';
import { db } from '@/lib/infra/db';
import { env } from '@/lib/infra/env';
import { getSession } from '@/lib/auth/session';
import { loadFeedbackPage } from '@/lib/feedback/inbox';
import {
  DEFAULT_PAGE_SIZE,
  parseFeedbackFilters,
  todayInZone,
  type QueryInput,
} from '@/lib/feedback/filters';
import { publicFormState, toFeedbackRow } from '@/lib/feedback/row';
import { FeedbackFilterForm } from './FeedbackFilterForm';
import { FeedbackInbox } from './FeedbackInbox';

/**
 * FB-02's `data` state — everything on `/app/feedback` that needs the tenant.
 *
 * Split out of `page.tsx` so the page itself awaits nothing and the Suspense fallback is a real
 * loading state rather than a component that never renders. The same division `app/(vendor)/app/page.tsx`
 * already draws for DASH-01.
 *
 * The tenant is resolved here rather than in the layout, which has no use for it (see the note in
 * `app/(vendor)/app/layout.tsx`). Nothing in this tree takes a business id from the request:
 * `TenantGuard.resolveActive` derives it from the session, which is what AC-003, FB-02-01 and RBAC
 * rule 2 require.
 *
 * Not gated on an ACTIVE tenant. Flow J stops a suspended business changing its configuration and
 * takes its public page down; it does not take away the messages customers already sent, and an
 * owner working out why they were suspended may well need to read them.
 */

export interface FeedbackInboxSectionProps {
  /** Awaited here rather than in the page, so the page can stay synchronous behind Suspense. */
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function FeedbackInboxSection({ searchParams }: FeedbackInboxSectionProps) {
  const session = await getSession();

  // The layout has already redirected an anonymous caller. Repeated because this component reads
  // tenant data and must not depend on a parent's guard for that; it also narrows the type.
  if (!session) redirect('/login');

  const database = db();
  const tenant = await new TenantGuard(database).resolveActive(session);
  if (!tenant.ok) return <NoBusinessFound />;

  const params: QueryInput = await searchParams;
  const { filters, rejected } = parseFeedbackFilters(params);

  const [page, slug] = await Promise.all([
    loadFeedbackPage(database, tenant.businessId, filters, {
      limit: DEFAULT_PAGE_SIZE,
      // The first page is always the newest. A cursor in the page URL would be a position from a
      // previous visit, and honouring it would open the inbox part-way down.
      cursor: null,
    }),
    new SlugService(database).primarySlugFor(tenant.businessId),
  ]);

  // Formatted here rather than in the client component: the label is a string prop the browser
  // reuses, which is what keeps hydration off `Intl.DateTimeFormat` (see `toFeedbackRow`).
  const initialRows = page.items.map((item) => toFeedbackRow(item, page.timeZone));

  // Keyed on the lifecycle, not on the slug. ONB-01 claims the slug at the identity save, so a
  // DRAFT business has an address that serves the Flow J unavailable page rather than the form —
  // `publicFormState` is where that distinction is made and tested.
  const publicForm = publicFormState(
    tenant.status,
    slug === null ? null : new URL(`/${slug}/feedback`, env().APP_BASE_URL).toString(),
  );

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <p className="text-xs font-semibold tracking-wider text-ink-muted uppercase">Feedback</p>
        <h1 className="text-2xl font-bold tracking-tight text-ink">Private feedback</h1>
        <p className="max-w-prose text-sm text-ink-muted">
          Messages customers sent straight to your business from your public page. Everyone who
          visits is offered this — nobody is asked to rate you first — so this is not a list of
          unhappy customers.
        </p>
        <p className="max-w-prose text-sm text-ink-muted">
          Names and mobile numbers are shown here only. They never appear on your public page and
          are left out of analytics reports.
        </p>
      </header>

      {rejected.length > 0 && (
        // Reported rather than 422-ed: a hand-edited or stale bookmarked address should still show
        // the inbox. `role="status"` because it is present on first render, so an assertive
        // interruption would be wrong.
        <InlineError role="status">
          {`We did not understand ${listFields(rejected)}, so ${
            rejected.length === 1 ? 'it was' : 'they were'
          } ignored.`}
        </InlineError>
      )}

      <FeedbackFilterForm
        filters={filters}
        timeZone={page.timeZone}
        todayInZone={todayInZone(page.timeZone)}
      />

      <FeedbackInbox
        filters={filters}
        initialRows={initialRows}
        initialNextCursor={page.nextCursor}
        initialCounts={page.counts}
        timeZone={page.timeZone}
        publicForm={publicForm}
      />
    </div>
  );
}

const FIELD_LABEL: Record<string, string> = {
  status: 'the status filter',
  from: 'the from date',
  to: 'the to date',
};

function listFields(rejected: readonly string[]): string {
  const labels = [...new Set(rejected)].map((field) => FIELD_LABEL[field] ?? `the ${field} filter`);
  if (labels.length === 1) return labels[0] ?? '';
  return `${labels.slice(0, -1).join(', ')} and ${labels.at(-1) ?? ''}`;
}

/**
 * A live session with no business behind it — a broken invariant rather than a normal state, since
 * signup creates the business in the same transaction as the user. Rendered rather than redirected
 * for the reason `components/dashboard/overview/DashboardOverview.tsx` gives: `/login` sends a
 * BUSINESS_OWNER straight back into `/app`, so a redirect would bounce forever.
 */
function NoBusinessFound() {
  return (
    <Card title="We could not find your business" titleAs="h2">
      <p className="text-sm text-ink-muted">
        This account is signed in but no business is attached to it, so there is no feedback inbox
        to show. Please contact Digital Hammerr — this is not something you can fix from this
        screen.
      </p>
    </Card>
  );
}

import { redirect } from 'next/navigation';
import { TenantGuard } from '@ai-review/core';
import { Card, EmptyState } from '@ai-review/ui';
import { db } from '@/lib/db';
import { getSession } from '@/lib/session';
import {
  DEFAULT_TEMPLATE_TEXT,
  findTrackedRequestUrl,
} from '@/app/api/v1/review-requests/template';
import {
  ensureDefaultTemplate,
  loadCustomerOptions,
  loadRecentRequests,
  loadTenantMessagingContext,
  whatsAppLinkFor,
} from '@/app/api/v1/review-requests/service';
import { describeBusinessStatus } from '../presentation';
import { RequestComposer } from './RequestComposer';
import { formatDateTime, formatOptionalDateTime } from './presentation';
import type { RequestRowView } from './types';

/**
 * REQ-01's `data` state — everything the composer needs, resolved on the server.
 *
 * Split out of `page.tsx` so the page awaits nothing and its Suspense fallback is a real loading
 * state, the same division `app/(app)/app/page.tsx` draws for DASH-01.
 *
 * The tenant is resolved here from the session, never from the request: `TenantGuard.resolveActive`
 * derives it, and every query below takes that id (RBAC rule 2, AC-003). `?customer=` is the one
 * value that arrives from the URL, and it is only ever compared against this tenant's own list — see
 * the composer, which drops an id that is not in it.
 *
 * Timestamps are formatted here rather than in the browser so hydration cannot disagree with the
 * server about a date separator; see `./types`.
 */
export async function ReviewRequestsScreen({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  // The layout has already redirected an anonymous caller. Repeated because this component reads
  // tenant data and must not rely on a parent's guard for that, and it narrows the type.
  if (!session) redirect('/login');

  const database = db();
  const tenant = await new TenantGuard(database).resolveActive(session);
  if (!tenant.ok) return <NoBusinessFound />;

  const businessId = tenant.businessId;

  const [context, template, customers, recent, params] = await Promise.all([
    loadTenantMessagingContext(database, businessId),
    // Seeded on first visit: REQ-01 shows a template and nothing else in the product creates one.
    ensureDefaultTemplate(database, businessId),
    loadCustomerOptions(database, businessId),
    loadRecentRequests(database, businessId),
    searchParams,
  ]);

  if (!context) return <NoBusinessFound />;

  const { timezone } = context;
  const status = describeBusinessStatus(context.status);

  const rows: RequestRowView[] = recent.map((row) => ({
    id: row.id,
    customerId: row.customerId,
    customerName: row.customerName,
    preparedAtIso: row.preparedAt.toISOString(),
    preparedAtLabel: formatDateTime(row.preparedAt.toISOString(), timezone),
    markedSentAtIso: row.markedSentAt?.toISOString() ?? null,
    markedSentAtLabel: formatOptionalDateTime(row.markedSentAt, timezone),
    firstClickedAtIso: row.firstClickedAt?.toISOString() ?? null,
    firstClickedAtLabel: formatOptionalDateTime(row.firstClickedAt, timezone),
    renderedMessage: row.renderedMessage,
    // Recovered from the stored message, because the token itself was never stored — see
    // `findTrackedRequestUrl`.
    reviewLink: findTrackedRequestUrl(row.renderedMessage),
    whatsappUrl: whatsAppLinkFor(row.customerMobile, row.renderedMessage),
  }));

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <p className="text-xs font-semibold tracking-wider text-ink-muted uppercase">
          Review requests
        </p>
        <h1 className="text-2xl font-bold tracking-tight text-ink">Ask a customer, personally</h1>
        <p className="max-w-prose text-sm text-ink-muted">
          Prepare a message for one customer, then send it yourself from WhatsApp or paste it
          wherever you like. Ai Review never messages your customers for you.
        </p>
      </header>

      {customers.length === 0 ? (
        <NoCustomers />
      ) : (
        <RequestComposer
          customers={customers.map((customer) => ({
            id: customer.id,
            name: customer.name,
            mobile: customer.mobile,
          }))}
          initialCustomerId={readCustomerParam(params.customer)}
          savedTemplateText={template?.templateText ?? DEFAULT_TEMPLATE_TEXT}
          timezone={timezone}
          isLive={status.isPubliclyLive}
          notLiveNote={
            status.isPubliclyLive
              ? null
              : `${status.note} Until then a tracked link would not open for your customer, so preparing one is paused.`
          }
          initialRows={rows}
        />
      )}
    </div>
  );
}

/**
 * REQ-01's fourth state, added rather than found in the spec.
 *
 * The screen spec lists `preview`, `copied` and `sent-manual` — all three of which assume a customer
 * exists. Flow F step 1 is "Business adds/selects customer", and CRM-01 owns the adding, so with an
 * empty contact list this screen has nothing to render and no honest way to fake one.
 *
 * No link to the customer list: `components/dashboard/nav-items.ts` shows CRM-01 as planned rather
 * than built, and a button to a route that 404s teaches an owner the product is broken. The sentence
 * says what has to happen without promising where.
 */
function NoCustomers() {
  return (
    <Card title="No customers yet" titleAs="h2">
      <EmptyState
        title="Add a customer first"
        description="A review request is prepared for one person, using their name and their number, so there is nothing to prepare until your contact list has someone in it. Once it does, they will be selectable here."
      />
    </Card>
  );
}

/**
 * A live session with no business behind it — a broken invariant rather than a normal state, since
 * signup creates the business in the same transaction as the user (see `lib/require-tenant.ts`).
 * Rendered rather than redirected, for the reason `DashboardOverview` gives: `/login` sends an owner
 * straight back to `/app`, so redirecting would bounce the browser between two routes.
 */
function NoBusinessFound() {
  return (
    <Card title="We could not find your business" titleAs="h2">
      <p className="text-sm text-ink-muted">
        This account is signed in but no business is attached to it, so there is nothing to prepare
        here. Please contact Digital Hammerr — this is not something you can fix from this screen.
      </p>
    </Card>
  );
}

/**
 * `?customer=` as CRM-01's "Prepare review request" action would send it.
 *
 * A repeated parameter arrives as an array; the first value is taken rather than the request being
 * refused, because a preselection is a convenience and getting it wrong costs nothing — the composer
 * validates the id against this tenant's list before selecting anything.
 */
function readCustomerParam(value: string | string[] | undefined): string | null {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value[0] ?? null;
  return null;
}

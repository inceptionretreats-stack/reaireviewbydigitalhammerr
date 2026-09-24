import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/lib/infra/db';
import { apiError } from '@/lib/http/api-error';
import { requireTenant } from '@/lib/tenant/require-tenant';
import { loadFeedbackPage } from '@/lib/feedback/inbox';
import { parseFeedbackFilters, parseFeedbackPageRequest } from '@/lib/feedback/filters';

/**
 * GET /api/v1/feedback — the `list` state of FB-02, with the date and status filters and the
 * pagination that screen needs.
 *
 * The tenant is never taken from the request: `requireTenant` resolves it from the session, so
 * there is no business id in the URL or body for a caller to tamper with (RBAC rule 2, AC-003).
 * FB-02-01 is the plainest case of that rule in the product — private feedback is a customer
 * writing to one business in confidence, so a cross-tenant read here discloses a stranger's
 * message rather than merely leaking a configuration row.
 *
 * ## PII (FB-02-02, AC-039)
 *
 * This response carries the customer's `name` and `mobile` when they supplied them. That is the
 * point of the screen — FB-02 lists them as its content — and AC-039 constrains where they may go
 * *next*: never onto a public page, never into an analytics property, never into an aggregate
 * export. This endpoint is the only surface in the product that emits them, it is session-guarded,
 * and it is marked `no-store` below so no shared cache holds a copy.
 *
 * There is deliberately no CSV or JSON export here. FB-02's actions are View, Mark read and
 * Archive; AN-01 is where the pack puts an export, and FB-02-02 exists to say that contact details
 * must be out of it by default. Adding an export to this screen would create precisely the file
 * FB-02-02 is warning about, so the absence is the requirement being met rather than a gap.
 *
 * Deliberately not gated on `requireActiveTenant`. Flow J stops a suspended tenant *mutating* its
 * configuration; this is a read, and a suspended owner still needs to see what their customers
 * wrote to them.
 *
 * No analytics event is emitted. `11_Analytics_Event_Taxonomy.csv` defines nothing for a merchant
 * reading their inbox, and the taxonomy is the contract (AN-01-01) — an event has to be added
 * there before a handler may write one.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireTenant(request);
  if (!auth.ok) return auth.response;

  const params = new URL(request.url).searchParams;
  const { filters, rejected: badFilters } = parseFeedbackFilters(params);
  const { limit, cursor, rejected: badPaging } = parseFeedbackPageRequest(params);
  const rejected = [...badFilters, ...badPaging];

  // The screen tolerates a malformed parameter and falls back to the default, because a stale
  // bookmark should not render a broken inbox. The API does not: a client that sent an
  // unparseable filter is getting a page it did not ask for, and answering 200 hides that.
  if (rejected.length > 0) {
    return apiError('VALIDATION_FAILED', 'One of the filters was not understood.', {
      details: { fields: [...new Set(rejected)] },
    });
  }

  const page = await loadFeedbackPage(db(), auth.context.businessId, filters, { limit, cursor });

  return NextResponse.json(
    {
      feedback: page.items,
      // Null on the last page. Pass it back as `cursor` unchanged to get the next one.
      next_cursor: page.nextCursor,
      // Per-status totals for the range, so the screen's chips do not need a second request.
      counts: page.counts,
      // Echoed back so a caller can tell which filters actually applied.
      filters: { status: filters.status, from: filters.from, to: filters.to },
      // AMENDMENT-004: the zone the `from`/`to` dates were read in, and the one a client should
      // render `created_at` in (AC-026).
      timezone: page.timeZone,
    },
    {
      headers: {
        // AC-039: the body contains customer contact details. Nothing may retain it — not a shared
        // cache, not the browser's back-forward store, not a proxy on a merchant's shop wifi.
        'Cache-Control': 'no-store, private',
      },
    },
  );
}

import { NextResponse, type NextRequest } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { businessLinks, businesses } from '@ai-review/db';
import { db } from '@/lib/infra/db';
import { apiError } from '@/lib/http/api-error';
import { readJsonObject } from '@/lib/http/request-body';
import { requireTenant } from '@/lib/tenant/require-tenant';
import { MAX_ORDERED_SECTIONS, hasDuplicates, sameMembers } from '@/lib/profile/order';
import { recordActivity } from '@/lib/activity/recorder';

/**
 * POST /api/v1/business/links/reorder — the persistence behind PROFILE-01's "drag to reorder".
 *
 * AC-021 requires ordering to persist "across devices and refresh", which makes order server state
 * rather than a client arrangement that happens to be saved with the rest of a form. That is why it
 * is its own endpoint and why the screen posts here the moment a section moves: a drag whose result
 * is lost by navigating away is the classic drag-and-drop trap, and on this screen it would read as
 * the feature not working.
 *
 * The request carries the whole arrangement — every section id, in the new order — and nothing else.
 * A per-row "move to position 3" would need the server to reason about what the other rows are doing
 * and can leave two sections sharing a position; one ordered list cannot.
 *
 * AC-003 applies as it does to every id arriving from a client. The tenant comes from the session,
 * ownership is part of the WHERE clause, and an id that is not this tenant's is answered exactly as
 * an id that does not exist — so a caller cannot probe for another tenant's section ids by watching
 * which ones this endpoint accepts.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireTenant(request);
  if (!auth.ok) return auth.response;

  // Flow J: a suspended or closed business must not edit its public page, or a suspension is
  // cosmetic. Not `requireActiveTenant`, which demands ACTIVE — a DRAFT tenant arranging its page
  // before publishing is the normal case on this screen.
  if (auth.context.status === 'SUSPENDED' || auth.context.status === 'CLOSED') {
    return apiError('BUSINESS_NOT_ACTIVE', 'This business is not active.');
  }

  const rawResult = await readJsonObject(request);
  if (!rawResult.ok) return rawResult.response;
  const raw = rawResult.body;

  const order = readOrder(raw);
  if (order === null) {
    return apiError('VALIDATION_FAILED', 'Malformed section order.', {
      details: { fields: ['order'] },
    });
  }

  if (order.length > MAX_ORDERED_SECTIONS) {
    return apiError('VALIDATION_FAILED', 'That is more sections than a page can hold.', {
      details: { fields: ['order'] },
    });
  }

  if (hasDuplicates(order)) {
    return apiError('VALIDATION_FAILED', 'Malformed section order.', {
      details: { fields: ['order'] },
    });
  }

  const database = db();
  const { businessId } = auth.context;

  const rows = await database
    .select({ id: businessLinks.id })
    .from(businessLinks)
    .where(eq(businessLinks.businessId, businessId));

  const owned = rows.map((row) => row.id);

  // Any submitted id that is not this tenant's — whether it belongs to another tenant or to nothing
  // at all — is answered identically, and deliberately before the completeness check below. The two
  // answers must not be distinguishable, or the endpoint becomes an existence oracle (AC-003).
  const ownedIds = new Set(owned);
  if (order.some((id) => !ownedIds.has(id))) {
    return apiError('RESOURCE_NOT_FOUND', 'We could not find one of those sections.');
  }

  // The complete set is required. A list missing a section would leave that section wherever it was
  // and silently produce an arrangement the owner never chose — which is what happens to a screen
  // that has not seen a section added or removed elsewhere. AC-021 makes the server the authority on
  // order, so a stale client is told to refresh rather than allowed to write half an order.
  if (!sameMembers(order, owned)) {
    return apiError(
      'VALIDATION_FAILED',
      'Your sections have changed somewhere else. Refresh this page and try again.',
      { details: { fields: ['order'] } },
    );
  }

  await database.transaction(async (tx) => {
    // One UPDATE per section rather than a single CASE expression: a tenant has five to eight
    // sections, MAX_ORDERED_SECTIONS bounds the worst case, and one statement per row is the version
    // that stays readable. All inside one transaction, so a partial arrangement is never visible —
    // an interrupted reorder would otherwise leave two sections sharing a position.
    for (const [index, id] of order.entries()) {
      await tx
        .update(businessLinks)
        .set({ sortOrder: index, updatedAt: new Date() })
        // Ownership stays in the WHERE clause even though every id was just checked: it costs
        // nothing and means no future edit to this loop can drop the guard (RBAC rule 2).
        .where(and(eq(businessLinks.id, id), eq(businessLinks.businessId, businessId)));
    }

    // AC-017's mechanism, reused: the bump invalidates cached public configuration, which is the
    // only thing that could still serve the previous order.
    await tx
      .update(businesses)
      .set({ configVersion: Date.now(), updatedAt: new Date() })
      .where(eq(businesses.id, businessId));
  });

  // Echoed back so the screen can confirm it holds what the server stored rather than assuming its
  // optimistic arrangement won.
  recordActivity(
    request,
    { session: auth.context.session, businessId: auth.context.businessId },
    {
      action: 'business.links.reorder',
      targetType: 'business',
      targetId: auth.context.businessId,
      metadata: { sections: order.length },
    },
  );
  return NextResponse.json({ order });
}

/**
 * Reads `{ order: [id, …] }`.
 *
 * Ids are shape-checked here rather than trusted into the query: a non-uuid would make Postgres
 * raise 22P02, and a malformed list is a client bug, not a server error.
 */
function readOrder(raw: unknown): string[] | null {
  if (typeof raw !== 'object' || raw === null || !('order' in raw)) return null;

  const value = (raw as { order: unknown }).order;
  if (!Array.isArray(value) || value.length === 0) return null;

  const ids: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || !UUID_PATTERN.test(entry)) return null;
    ids.push(entry);
  }
  return ids;
}

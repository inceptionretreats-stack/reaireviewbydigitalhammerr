import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { TenantGuard } from '@ai-review/core';
import { businesses } from '@ai-review/db';
import { listModes, toWireMode } from '@/app/api/v1/ai/modes/mode-service';
import { describeBusinessStatus } from '@/components/dashboard/presentation';
import { ReviewModesManager } from '@/components/dashboard/ai/ReviewModesManager';
import { db } from '@/lib/db';
import { getSession } from '@/lib/session';

/**
 * AI-02 — `/app/review-modes`.
 *
 * A Server Component that hands the list to a client component in exactly the shape
 * `GET /api/v1/ai/modes` returns, through the endpoint's own `listModes` and `toWireMode`. That is
 * the point of routing the first paint through those two functions rather than a private query: the
 * server-rendered list and the list the client maintains after a create or a switch are then the
 * same data in the same order, so nothing jumps when the first mutation lands.
 *
 * The tenant is resolved from the session, never from the request (RBAC rule 2, AC-003), and
 * `listModes` puts it in the WHERE clause, so this page cannot render another tenant's modes.
 *
 * `businesses.status` is read for one reason: every mutation on this screen goes through
 * `refuseFrozenTenant`, which rejects SUSPENDED and CLOSED with BUSINESS_NOT_ACTIVE (Flow J). So
 * `canManage` mirrors that guard exactly — DRAFT and ACTIVE may write, which is *not*
 * `requireActiveTenant`'s condition, because an owner sets modes up before publishing — so the
 * screen offers no control the API would refuse. The one sentence explaining why comes from
 * `describeBusinessStatus`, so a suspended owner is told that support is the route out rather than
 * being left with the bare "This business is not active."
 */

export const metadata: Metadata = {
  title: 'Review modes | AI Review',
  description: 'Choose which topics your customers’ drafts lean on.',
};

export default async function Page() {
  const database = db();

  const tenant = await new TenantGuard(database).resolveActive(await getSession());

  // `/app` explains the case of a signed-in user with no business; `/login` would bounce back here.
  if (!tenant.ok) redirect('/app');

  // `resolveActive` carries the status as a plain string; this select narrows it to the enum
  // `describeBusinessStatus` is exhaustive over, so a new lifecycle state is a compile error here
  // rather than an unexplained screen.
  const [businessRows, modes] = await Promise.all([
    database
      .select({ status: businesses.status })
      .from(businesses)
      .where(eq(businesses.id, tenant.businessId))
      .limit(1),
    listModes(database, tenant.businessId),
  ]);

  const business = businessRows[0];
  if (!business) redirect('/app');

  const status = describeBusinessStatus(business.status);

  return (
    <ReviewModesManager
      initialModes={modes.map(toWireMode)}
      // Exactly the condition `refuseFrozenTenant` applies to POST /ai/modes,
      // PATCH /ai/modes/{id} and POST /ai/modes/{id}/activate.
      canManage={business.status === 'DRAFT' || business.status === 'ACTIVE'}
      statusNote={status.note}
    />
  );
}

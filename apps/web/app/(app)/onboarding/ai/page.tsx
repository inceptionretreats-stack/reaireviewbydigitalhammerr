import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { TenantGuard } from '@ai-review/core';
import { aiBusinessContexts, reviewModes } from '@ai-review/db';
import { db } from '@/lib/db';
import { getSession } from '@/lib/session';
import { AiContextStep } from '@/components/onboarding/AiContextStep';

/**
 * ONB-04 — `/onboarding/ai`.
 *
 * A Server Component so the step renders with what is already stored rather than flashing empty
 * fields and filling them in from a client fetch. An owner reaching this step a second time (every
 * screen offers Save & exit) must see their own terms, not a blank form that looks like their work
 * was lost.
 *
 * The read is a direct query rather than a call to GET /api/v1/ai/context: a Server Component
 * cannot reach its own route handler without an absolute URL and hand-forwarded cookies, and the
 * round trip would buy nothing — the handler's guard is this same TenantGuard. The GET endpoint
 * remains what the AI-01 settings screen and any client-side refresh use.
 */

export const metadata: Metadata = {
  title: 'AI context | AI Review',
  description: 'Tell the writing assistant what your business does.',
};

export default async function Page() {
  const database = db();

  // `resolveActive` treats a missing session as a scope failure, so one branch covers both an
  // expired cookie and a user with no business. It takes no business id from the request at all
  // (RBAC rule 2), which is what makes this safe to run before anything is read.
  const tenant = await new TenantGuard(database).resolveActive(await getSession());
  if (!tenant.ok) redirect('/login');

  // Two independent single-row lookups, so they are issued together rather than one after the
  // other. Onboarding is deliberately not gated on an ACTIVE tenant: it runs against a DRAFT
  // business, which is the one state that legitimately is not active yet (Flow J).
  const [contextRows, modeRows] = await Promise.all([
    database
      .select({
        summary: aiBusinessContexts.summary,
        services: aiBusinessContexts.services,
        contextTerms: aiBusinessContexts.contextTerms,
      })
      .from(aiBusinessContexts)
      .where(eq(aiBusinessContexts.businessId, tenant.businessId))
      .limit(1),
    database
      .select({ name: reviewModes.name })
      .from(reviewModes)
      .where(
        and(
          eq(reviewModes.businessId, tenant.businessId),
          eq(reviewModes.isActive, true),
          eq(reviewModes.isArchived, false),
        ),
      )
      .limit(1),
  ]);

  const context = contextRows[0];

  return (
    <AiContextStep
      initialSummary={context?.summary ?? ''}
      initialServices={toStringArray(context?.services)}
      initialContextTerms={toStringArray(context?.contextTerms)}
      activeModeName={modeRows[0]?.name ?? null}
    />
  );
}

/**
 * `services` and `context_terms` are jsonb with no `$type<string[]>()`, so Drizzle hands them back
 * as `unknown`. Narrowing rather than casting: the column is only ever written through
 * `aiContextRequest`, but a hand-edited or seeded row can hold anything, and a bad value would
 * otherwise crash the step instead of degrading to an empty list.
 */
function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

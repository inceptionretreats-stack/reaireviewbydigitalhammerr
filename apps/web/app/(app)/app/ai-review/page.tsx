import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { TenantGuard } from '@ai-review/core';
import { aiBusinessContexts, businesses } from '@ai-review/db';
import { listModes } from '@/app/api/v1/ai/modes/mode-service';
import { ActiveModeCard } from '@/components/dashboard/ai/ActiveModeCard';
import { AiReviewSettings } from '@/components/dashboard/ai/AiReviewSettings';
import { PromptExplanation } from '@/components/dashboard/ai/PromptExplanation';
import { db } from '@/lib/db';
import { toDraftLanguage } from '@/lib/draft-language';
import { getSession } from '@/lib/session';

/**
 * AI-01 — `/app/ai-review`.
 *
 * A Server Component so the form renders with what is already stored rather than flashing empty
 * fields and filling them in from a client fetch. An owner who wrote their context during
 * onboarding must find their own words here, not a blank form that looks like the work was lost.
 *
 * The reads are direct queries rather than calls to `GET /api/v1/ai/context`: a Server Component
 * cannot reach its own route handler without an absolute URL and hand-forwarded cookies, and the
 * round trip would buy nothing — the handler's guard is this same TenantGuard. `listModes` is
 * reused from the AI-02 endpoint rather than re-queried, so this screen and that one cannot
 * disagree about which mode is in use.
 *
 * `AI-01` lists no `loading` state, and this page has nothing worth streaming: three small indexed
 * reads issued together. DASH-01's Suspense split exists because its aggregation is slow; copying
 * it here would add a skeleton nobody sees.
 */

export const metadata: Metadata = {
  title: 'Ai review context | Ai Review',
  description: 'The background your customers’ drafts are written from.',
};

export default async function Page() {
  const database = db();

  // `resolveActive` treats a missing session as a scope failure, so one branch covers an expired
  // cookie and a user with no business. It takes no business id from the request (RBAC rule 2).
  const tenant = await new TenantGuard(database).resolveActive(await getSession());

  // `/app` renders the explanation for a signed-in user with no business, and sending them to
  // `/login` would bounce forever because login sends a business owner straight back to `/app`.
  if (!tenant.ok) redirect('/app');

  const [businessRows, contextRows, modes] = await Promise.all([
    database
      .select({ description: businesses.description })
      .from(businesses)
      .where(eq(businesses.id, tenant.businessId))
      .limit(1),
    database
      .select({
        summary: aiBusinessContexts.summary,
        services: aiBusinessContexts.services,
        contextTerms: aiBusinessContexts.contextTerms,
        draftLanguage: aiBusinessContexts.draftLanguage,
      })
      .from(aiBusinessContexts)
      .where(eq(aiBusinessContexts.businessId, tenant.businessId))
      .limit(1),
    listModes(database, tenant.businessId),
  ]);

  const context = contextRows[0];
  const activeMode = modes.find((mode) => mode.isActive && !mode.isArchived) ?? null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold tracking-tight text-ink">Ai review settings</h1>
        <p className="max-w-2xl text-sm text-ink-muted">
          Add your business details to help Ai draft reviews customers can edit.
        </p>
      </div>

      <AiReviewSettings
        initialSummary={context?.summary ?? ''}
        initialServices={toStringArray(context?.services)}
        initialContextTerms={toStringArray(context?.contextTerms)}
        initialDraftLanguage={toDraftLanguage(context?.draftLanguage)}
        profileDescription={businessRows[0]?.description ?? ''}
      />

      <ActiveModeCard
        activeModeName={activeMode?.name ?? null}
        activeModeTerms={activeMode?.contextTerms ?? []}
        modeCount={modes.length}
      />

      <PromptExplanation />
    </div>
  );
}

/**
 * `services` and `context_terms` are jsonb with no `$type<string[]>()`, so Drizzle hands them back
 * as `unknown`. Narrowed rather than cast: the columns are only written through `aiContextRequest`,
 * but a seeded or hand-edited row can hold anything, and a bad value should degrade to an empty
 * list rather than crash the screen.
 */
function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

import { and, desc, eq } from 'drizzle-orm';
import {
  aiBusinessContexts,
  aiGenerations,
  aiPromptVersions,
  businesses,
  reviewModes,
  subscriptions,
  type Database,
} from '@ai-review/db';
import {
  PostgresQuotaStore,
  QuotaService,
  OpenAiProvider,
  ReviewGenerator,
  StubAiProvider,
  type AiProvider,
  type PromptVersionConfig,
} from '@ai-review/core';

/**
 * Assembles a generation from stored configuration (Flow C, E4).
 *
 * The model and prompt come from ai_prompt_versions rather than source (ADR-006), so an AI
 * quality change is a data change with rollback, not a deploy (ADMIN-03-03).
 */

export interface GenerationContext {
  promptVersion: PromptVersionConfig;
  business: {
    name: string;
    category: string;
    city: string | null;
    description: string | null;
    services: string[];
    contextTerms: string[];
  };
  reviewMode: { name: string; description: string | null; contextTerms: string[] } | null;
  reviewModeId: string | null;
}

/** ADMIN-03-01: exactly one ACTIVE version is the production default. */
export async function loadActivePromptVersion(db: Database): Promise<PromptVersionConfig | null> {
  const [row] = await db
    .select()
    .from(aiPromptVersions)
    .where(eq(aiPromptVersions.status, 'ACTIVE'))
    .limit(1);

  if (!row) return null;

  return {
    id: row.id,
    version: row.version,
    model: row.model,
    systemPrompt: row.systemPrompt,
    maxOutputTokens: row.maxOutputTokens,
    reasoningEffort: row.reasoningEffort,
    outputSchema: row.outputSchema as Record<string, unknown>,
  };
}

export async function loadGenerationContext(
  db: Database,
  businessId: string,
): Promise<GenerationContext | null> {
  const promptVersion = await loadActivePromptVersion(db);
  if (!promptVersion) return null;

  const [business] = await db
    .select({
      name: businesses.name,
      category: businesses.category,
      city: businesses.city,
      description: businesses.description,
    })
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);

  if (!business) return null;

  const [context] = await db
    .select({ services: aiBusinessContexts.services, terms: aiBusinessContexts.contextTerms })
    .from(aiBusinessContexts)
    .where(eq(aiBusinessContexts.businessId, businessId))
    .limit(1);

  const [mode] = await db
    .select({
      id: reviewModes.id,
      name: reviewModes.name,
      description: reviewModes.description,
      contextTerms: reviewModes.contextTerms,
    })
    .from(reviewModes)
    .where(
      and(
        eq(reviewModes.businessId, businessId),
        eq(reviewModes.isActive, true),
        eq(reviewModes.isArchived, false),
      ),
    )
    .limit(1);

  return {
    promptVersion,
    business: {
      name: business.name,
      category: business.category,
      city: business.city,
      description: business.description,
      services: asStringArray(context?.services),
      contextTerms: asStringArray(context?.terms),
    },
    reviewMode: mode
      ? {
          name: mode.name,
          description: mode.description,
          contextTerms: asStringArray(mode.contextTerms),
        }
      : null,
    reviewModeId: mode?.id ?? null,
  };
}

/**
 * The last few drafts from this session, newest first, for the variation gate.
 * The spec compares against at most three (regeneration algorithm step 1).
 */
export async function loadPreviousDrafts(
  db: Database,
  anonymousSessionId: string,
): Promise<string[]> {
  const rows = await db
    .select({ text: aiGenerations.reviewText })
    .from(aiGenerations)
    .where(eq(aiGenerations.anonymousSessionId, anonymousSessionId))
    .orderBy(desc(aiGenerations.createdAt))
    .limit(3);

  return rows.map((r) => r.text);
}

/**
 * Provider selection.
 *
 * The stub is used whenever no API key is configured, so local development and CI exercise the
 * whole flow — quota, gates, funnel — without reaching a paid provider. Production cannot reach
 * that branch: packages/config requires the key there, so a deployment that forgets it fails at
 * boot rather than quietly serving canned drafts as though a model had written them.
 *
 * Note there is no automatic failover to the fallback model. Terra costs 10x Luna, so a
 * full-traffic failover during an incident would take AI spend from roughly 5% of revenue to
 * roughly 45%. 02_System_Architecture.md specifies degrading to a retry state instead, which
 * is both the specified behaviour and the affordable one.
 */
export function selectProvider(apiKey: string | undefined): AiProvider {
  if (!apiKey) return new StubAiProvider('ok');
  return new OpenAiProvider({ apiKey });
}

export function buildGenerator(db: Database, provider: AiProvider): ReviewGenerator {
  return new ReviewGenerator(provider, new QuotaService(new PostgresQuotaStore(db)));
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/**
 * The plan, for the rate limiter's fair-use dimension.
 *
 * A separate small read rather than a value threaded out of the generator: the limiter runs
 * *before* generation (a denied request must not reach the provider or the quota counter), so
 * the entitlement the generator resolves later is not available yet. D-006 means this only
 * changes whether the OBSERVE dimension is attached, so a stale answer costs an alert, not a
 * wrong decision.
 */
export async function loadPlan(db: Database, businessId: string): Promise<'FREE' | 'PRO'> {
  const [row] = await db
    .select({ status: subscriptions.status, expiresAt: subscriptions.expiresAt })
    .from(subscriptions)
    .where(eq(subscriptions.businessId, businessId))
    .limit(1);

  if (!row || row.status !== 'PRO_ACTIVE') return 'FREE';
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return 'FREE';
  return 'PRO';
}

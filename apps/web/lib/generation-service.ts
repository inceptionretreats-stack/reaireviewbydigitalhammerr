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
  AnthropicProvider,
  GeminiProvider,
  OpenAiProvider,
  ReviewGenerator,
  StubAiProvider,
  DEFAULT_DRAFT_LANGUAGE,
  parseGuidance,
  type AiProvider,
  type DraftLanguage,
  type PromptVersionConfig,
  type QuotaReservation,
} from '@ai-review/core';
import { env } from './env';
import { safeError } from './safe-error';

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
  /** CHANGE-003. Per business; Hinglish when the business has never saved a context row. */
  draftLanguage: DraftLanguage;
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
    guidance: parseGuidance(row.guidance),
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
    .select({
      services: aiBusinessContexts.services,
      terms: aiBusinessContexts.contextTerms,
      draftLanguage: aiBusinessContexts.draftLanguage,
    })
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
    draftLanguage: context?.draftLanguage ?? DEFAULT_DRAFT_LANGUAGE,
  };
}

/**
 * The last few drafts from this session, newest first, for the variation gate.
 * The spec compares against at most three (regeneration algorithm step 1).
 */
/**
 * The most recent draft this anonymous session already has, if any.
 *
 * The review page generates on arrival now, so a visitor sees words rather than a button. That
 * makes a page refresh a billable event unless something remembers what was already written —
 * and on the free plan a business has ten generations for its lifetime, so ten curious refreshes
 * would spend the whole allowance before anyone posted anything.
 *
 * Reusing the session's last draft is also what a customer expects: coming back to the page
 * should show the review they were part-way through editing, not silently replace it.
 */
export async function loadLatestDraft(
  db: Database,
  anonymousSessionId: string,
): Promise<{ text: string; generationId: string } | null> {
  const [row] = await db
    .select({ id: aiGenerations.id, text: aiGenerations.reviewText })
    .from(aiGenerations)
    .where(eq(aiGenerations.anonymousSessionId, anonymousSessionId))
    .orderBy(desc(aiGenerations.createdAt))
    .limit(1);

  return row ? { text: row.text, generationId: row.id } : null;
}

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
 * The stub is used only when neither key is configured, so local development and CI exercise
 * the whole flow — quota, gates, funnel — without reaching a paid provider. Production cannot
 * reach that branch: packages/config requires one of the two there, so a deployment that forgets
 * both fails at boot rather than quietly serving canned drafts as though a model had written them.
 *
 * Precedence when more than one key is set: Anthropic, then OpenAI, then Gemini. Deliberate
 * and stated rather than an accident of ordering: a deployment holding two keys has one it
 * means to use, and silently picking by declaration order would make the active vendor a
 * property of this file rather than of configuration. Gemini is last because it is the one
 * with a free tier — an owner who later adds a paid key has upgraded, and the paid key should
 * win without them having to remember to remove the free one. Unsetting keys is the way to
 * switch the other direction.
 *
 * Both branches were unreachable until recently — this function returned the stub either way,
 * which is exactly the sort of thing that survives review and every gate. Hence the test.
 *
 * Note there is no automatic failover to the fallback model. Terra costs 10x Luna, so a
 * full-traffic failover during an incident would take AI spend from roughly 5% of revenue to
 * roughly 45%. 02_System_Architecture.md specifies degrading to a retry state instead, which
 * is both the specified behaviour and the affordable one.
 */
/**
 * The configured credentials, read from the validated environment.
 *
 * A helper rather than two inline reads: the routes should not each decide which keys exist or
 * in what order they are considered, or the precedence documented above becomes two facts that
 * can disagree.
 */
export function providerKeys(): ProviderKeys {
  return {
    anthropic: env().ANTHROPIC_API_KEY,
    openai: env().OPENAI_API_KEY,
    gemini: env().GEMINI_API_KEY,
  };
}

export interface ProviderKeys {
  anthropic?: string | undefined;
  openai?: string | undefined;
  gemini?: string | undefined;
}

export function selectProvider(keys: ProviderKeys): AiProvider {
  if (keys.anthropic) return new AnthropicProvider({ apiKey: keys.anthropic });
  if (keys.openai) return new OpenAiProvider({ apiKey: keys.openai });
  if (keys.gemini) return new GeminiProvider({ apiKey: keys.gemini });
  return new StubAiProvider('ok');
}

export function buildGenerator(db: Database, provider: AiProvider): ReviewGenerator {
  return new ReviewGenerator(provider, new QuotaService(new PostgresQuotaStore(db)));
}

/**
 * Hands a committed reservation back (AC-014).
 *
 * Used when the draft was generated but could not be persisted or returned: the generator has
 * already committed by then, so the customer would otherwise be charged for a draft they never
 * saw. Never throws — failing to release must not turn a recoverable error into a 500 on top
 * of one, and the server log is the place that records it.
 */
export async function releaseQuota(db: Database, reservation: QuotaReservation): Promise<void> {
  try {
    await new QuotaService(new PostgresQuotaStore(db)).release(reservation);
  } catch (error) {
    console.error('[quota] could not release a reservation after a failed draft', safeError(error));
  }
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/**
 * The plan, for the rate limiter's paid abuse-observation dimension.
 *
 * A separate small read rather than a value threaded out of the generator: the limiter runs
 * *before* generation (a denied request must not reach the provider or the quota counter), so
 * the entitlement the generator resolves later is not available yet. This only changes whether
 * the OBSERVE dimension is attached, so a stale answer costs an alert, not a wrong decision.
 */
export async function loadPlan(db: Database, businessId: string): Promise<'FREE' | 'PRO'> {
  const [row] = await db
    .select({
      status: subscriptions.status,
      startsAt: subscriptions.startsAt,
      expiresAt: subscriptions.expiresAt,
    })
    .from(subscriptions)
    .where(eq(subscriptions.businessId, businessId))
    .limit(1);

  if (!row || (row.status !== 'PRO_ACTIVE' && row.status !== 'PAST_DUE')) return 'FREE';
  if (!row.startsAt || !row.expiresAt) return 'FREE';
  const now = Date.now();
  if (row.startsAt.getTime() > now || row.expiresAt.getTime() <= now) return 'FREE';
  return 'PRO';
}

/**
 * AMENDMENT-030 — the admin's Ai controls for a business, read before the limiter runs:
 * a suspension refuses the request outright, a live throttle becomes a limiter dimension.
 */
export async function loadAiControls(
  db: Database,
  businessId: string,
): Promise<{ suspended: boolean; throttle: { perHour: number; untilMs: number } | undefined }> {
  const [row] = await db
    .select({
      aiSuspendedAt: businesses.aiSuspendedAt,
      aiThrottleUntil: businesses.aiThrottleUntil,
      aiThrottlePerHour: businesses.aiThrottlePerHour,
    })
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);
  const live =
    row?.aiThrottleUntil !== null &&
    row?.aiThrottleUntil !== undefined &&
    row.aiThrottleUntil.getTime() > Date.now() &&
    row.aiThrottlePerHour !== null;
  return {
    suspended: row?.aiSuspendedAt !== null && row?.aiSuspendedAt !== undefined,
    throttle: live
      ? { perHour: row!.aiThrottlePerHour!, untilMs: row!.aiThrottleUntil!.getTime() }
      : undefined,
  };
}

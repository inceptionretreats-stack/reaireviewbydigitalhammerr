import { NextResponse, type NextRequest } from 'next/server';
import { buildPrompt, checkOutputCompliance } from '@ai-review/core';
import { db } from '@/lib/infra/db';
import { env } from '@/lib/infra/env';
import { apiError } from '@/lib/http/api-error';
import { requireTenant } from '@/lib/tenant/require-tenant';
import { isDenied, rateLimiter } from '@/lib/http/rate-limit';
import { loadGenerationContext, providerKeys, selectProvider } from '@/lib/ai/generation-service';
import { previewCheck } from './preview-limit';
import { recordActivity } from '@/lib/activity/recorder';

/**
 * POST /api/v1/ai/test-preview — ONB-04 "Generate preview" and AI-01 "Test preview".
 *
 * ONB-04-02 and AI-01-01 both require that a preview does NOT consume quota, so this deliberately
 * does not go through QuotaService or ReviewGenerator: it calls the provider directly. That is the
 * whole reason it is a separate endpoint rather than a flag on the public one — a flag is
 * something a public caller could set, and the free tier would be bypassable.
 *
 * The corollary the owner does not see: a preview still costs a real provider call. It is
 * therefore rate limited — `previewCheck` in ./preview-limit argues the dimensions, the tenant key
 * and the fail-closed policy — and no generation row is written, so a preview never appears in
 * analytics or in the funnel as a customer draft.
 *
 * Compliance is still checked. The draft shown to an owner is the one their customers will get,
 * so a preview that quietly skipped the AC-011/AC-012 gates would misrepresent the product to the
 * person deciding whether to publish it.
 */
/**
 * The generator waits on the model for up to AI_REQUEST_TIMEOUT_MS and retries once on a 503, so
 * on a serverless host the function must be allowed to outlive a default 10 s budget. Ignored
 * by `next start`; read by Vercel.
 */
export const maxDuration = 60;

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireTenant(request);
  if (!auth.ok) return auth.response;

  // Before the context read and before the provider call: a denied preview must cost neither a
  // query nor a paid token, which is the whole point of the dimension.
  const decision = await rateLimiter().consume(previewCheck(auth.context.businessId));

  if (isDenied(decision)) {
    return apiError(
      decision.code,
      'You have generated several previews just now. Please wait a moment and try again.',
      { retryAfterSeconds: decision.retryAfterSeconds },
    );
  }

  const database = db();
  const context = await loadGenerationContext(database, auth.context.businessId);

  if (!context) {
    return apiError(
      'AI_PROVIDER_UNAVAILABLE',
      'The preview is unavailable right now. You can still finish setting up and publish.',
    );
  }

  const prompt = buildPrompt(
    {
      business: context.business,
      reviewMode: context.reviewMode,
      previousDrafts: [],
      generationNumber: 1,
      draftLanguage: context.draftLanguage,
      // A fresh seed per preview, so ten previews in a row show the owner ten openings rather
      // than the model's single favourite.
      variationSeed: crypto.randomUUID(),
    },
    context.promptVersion.systemPrompt,
    context.promptVersion.guidance,
  );

  try {
    const result = await selectProvider(providerKeys()).generate({
      prompt,
      model: context.promptVersion.model,
      maxOutputTokens: context.promptVersion.maxOutputTokens,
      reasoningEffort: context.promptVersion.reasoningEffort,
      timeoutMs: env().AI_REQUEST_TIMEOUT_MS,
      outputSchema: context.promptVersion.outputSchema,
    });

    const text = result.output.review_text.trim();
    const compliance = checkOutputCompliance(text);

    recordActivity(
      request,
      { session: auth.context.session, businessId: auth.context.businessId },
      {
        action: 'ai.test_preview',
        metadata: {
          prompt_version: context.promptVersion.version,
          compliance_passed: compliance.passed,
        },
      },
    );
    return NextResponse.json({
      review_text: text,
      prompt_version: context.promptVersion.version,
      // Surfaced so the owner understands what they are looking at: a starting point their
      // customer edits and confirms, not a review that will be posted as-is (ADR-008).
      editable_by_customer: true,
      requires_experience_confirmation: true,
      compliance_passed: compliance.passed,
      counts_toward_quota: false,
    });
  } catch (error) {
    // A raw provider error must never reach a client (02_System_Architecture.md, AC-030).
    console.warn(
      '[ai] preview failed',
      error instanceof Error ? `${error.name}: ${error.message}` : 'unknown',
    );
    return apiError(
      'AI_PROVIDER_UNAVAILABLE',
      'The preview is unavailable right now. You can still finish setting up and publish.',
    );
  }
}

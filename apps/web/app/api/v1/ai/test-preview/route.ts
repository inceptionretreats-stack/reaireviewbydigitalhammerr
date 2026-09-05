import { NextResponse, type NextRequest } from 'next/server';
import { buildPrompt, checkOutputCompliance } from '@ai-review/core';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { apiError } from '@/lib/api-error';
import { requireTenant } from '@/lib/require-tenant';
import { loadGenerationContext, selectProvider } from '@/lib/generation-service';

/**
 * POST /api/v1/ai/test-preview — ONB-04 "Generate preview" and AI-01 "Test preview".
 *
 * ONB-04-02 and AI-01-01 both require that a preview does NOT consume quota, so this deliberately
 * does not go through QuotaService or ReviewGenerator: it calls the provider directly. That is the
 * whole reason it is a separate endpoint rather than a flag on the public one — a flag is
 * something a public caller could set, and the free tier would be bypassable.
 *
 * The corollary the owner does not see: a preview still costs a real provider call. It is
 * therefore rate limited, and no generation row is written, so it never appears in analytics or in
 * the funnel as a customer draft.
 *
 * Compliance is still checked. The draft shown to an owner is the one their customers will get,
 * so a preview that quietly skipped the AC-011/AC-012 gates would misrepresent the product to the
 * person deciding whether to publish it.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireTenant(request);
  if (!auth.ok) return auth.response;

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
    },
    context.promptVersion.systemPrompt,
  );

  try {
    const result = await selectProvider(env().OPENAI_API_KEY).generate({
      prompt,
      model: context.promptVersion.model,
      maxOutputTokens: context.promptVersion.maxOutputTokens,
      reasoningEffort: context.promptVersion.reasoningEffort,
      timeoutMs: env().AI_REQUEST_TIMEOUT_MS,
      outputSchema: context.promptVersion.outputSchema,
    });

    const text = result.output.review_text.trim();
    const compliance = checkOutputCompliance(text);

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

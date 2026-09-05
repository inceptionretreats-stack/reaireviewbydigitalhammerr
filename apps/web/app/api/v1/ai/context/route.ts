import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { aiBusinessContexts, businesses, reviewModes } from '@ai-review/db';
import { aiContextRequest } from '@ai-review/contracts';
import { db } from '@/lib/db';
import { apiError } from '@/lib/api-error';
import { requireTenant } from '@/lib/require-tenant';

/**
 * GET/PUT /api/v1/ai/context — ONB-04 and AI-01.
 *
 * D-025 is the decision that shapes this: merchant terms are AI *context*, not mandatory wording.
 * There is deliberately no field here for required keywords, and 09_AI_Prompt_and_Generation_Spec
 * is explicit that no setting called "mandatory keywords in every review" may exist. The contract
 * in packages/contracts omits it too, so adding one would take a deliberate edit in two places.
 *
 * AI-01-02: a business owner cannot reach the global system prompt. Nothing in this handler reads
 * or writes ai_prompt_versions — that is admin-only data (ADR-006).
 */

/** Balanced is created on first save so a business always has an active mode to generate under. */
const DEFAULT_MODE_NAME = 'Balanced';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireTenant(request);
  if (!auth.ok) return auth.response;

  const database = db();
  const [context] = await database
    .select({
      summary: aiBusinessContexts.summary,
      services: aiBusinessContexts.services,
      contextTerms: aiBusinessContexts.contextTerms,
    })
    .from(aiBusinessContexts)
    .where(eq(aiBusinessContexts.businessId, auth.context.businessId))
    .limit(1);

  const modes = await database
    .select({ id: reviewModes.id, name: reviewModes.name, isActive: reviewModes.isActive })
    .from(reviewModes)
    .where(eq(reviewModes.businessId, auth.context.businessId));

  return NextResponse.json({
    summary: context?.summary ?? null,
    services: context?.services ?? [],
    context_terms: context?.contextTerms ?? [],
    modes,
  });
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  const auth = await requireTenant(request);
  if (!auth.ok) return auth.response;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return apiError('VALIDATION_FAILED', 'Malformed request body.');
  }

  const parsed = aiContextRequest.safeParse(raw);
  if (!parsed.success) {
    return apiError('VALIDATION_FAILED', 'Please check the details you entered.', {
      details: {
        fields: [...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? 'body')))],
      },
    });
  }

  const { summary, services, context_terms: contextTerms } = parsed.data;
  const { businessId, session } = auth.context;
  const database = db();

  await database.transaction(async (tx) => {
    await tx
      .insert(aiBusinessContexts)
      .values({
        businessId,
        summary: summary ?? null,
        services,
        contextTerms,
        updatedBy: session.userId,
      })
      .onConflictDoUpdate({
        target: aiBusinessContexts.businessId,
        set: {
          summary: summary ?? null,
          services,
          contextTerms,
          updatedBy: session.userId,
          updatedAt: new Date(),
        },
      });

    // Generation resolves the active mode and would otherwise find none on a fresh tenant.
    // Balanced carries no extra terms by design: a mode shifts emphasis, and the default should
    // shift nothing (glossary, and AI-02's rule that a mode is never a sentiment gate).
    const existingModes = await tx
      .select({ id: reviewModes.id })
      .from(reviewModes)
      .where(eq(reviewModes.businessId, businessId))
      .limit(1);

    if (existingModes.length === 0) {
      await tx.insert(reviewModes).values({
        businessId,
        name: DEFAULT_MODE_NAME,
        description: 'General context for your business.',
        contextTerms: [],
        isActive: true,
      });
    }

    await tx
      .update(businesses)
      .set({ configVersion: Date.now(), updatedAt: new Date() })
      .where(eq(businesses.id, businessId));
  });

  return NextResponse.json({ saved: true });
}

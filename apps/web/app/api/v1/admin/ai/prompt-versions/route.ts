import { NextResponse } from 'next/server';
import { promptVersionCreate } from '@ai-review/contracts';
import { PromptVersionService, parseGuidance } from '@ai-review/core';
import { db } from '@/lib/db';
import { apiError } from '@/lib/api-error';
import { requireAdmin } from '@/lib/require-admin';
import { promptVersionErrorResponse, toWire } from '@/lib/admin/prompt-versions';

export const runtime = 'nodejs';

/** ADMIN-03: every version, newest first. */
export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;
  const versions = await new PromptVersionService(db()).list();
  return NextResponse.json({ versions: versions.map(toWire) });
}

/**
 * "Create draft" / "Clone version". With `clone_from`, every field the body omits is copied from
 * that version — including the output schema, which the UI never edits because the providers'
 * strict-mode contracts depend on it.
 */
export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return apiError('VALIDATION_FAILED', 'Malformed request body.');
  }
  const parsed = promptVersionCreate.safeParse(raw);
  if (!parsed.success) {
    return apiError(
      'VALIDATION_FAILED',
      parsed.error.issues[0]?.message ?? 'Please check the details.',
      {
        details: {
          fields: [...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? 'body')))],
        },
      },
    );
  }

  const service = new PromptVersionService(db());
  const source = parsed.data.clone_from ? await service.get(parsed.data.clone_from) : null;
  if (parsed.data.clone_from && !source) {
    return apiError('RESOURCE_NOT_FOUND', 'No such prompt version to clone.');
  }
  const body = parsed.data;
  const missing = (field: string) =>
    apiError('VALIDATION_FAILED', `${field} is required when not cloning.`, {
      details: { fields: [field] },
    });
  if (!source && body.model === undefined) return missing('model');
  if (!source && body.system_prompt === undefined) return missing('system_prompt');
  if (!source && body.max_output_tokens === undefined) return missing('max_output_tokens');

  try {
    const created = await service.createDraft({
      actor: auth.context.actor,
      fields: {
        version: body.version,
        model: body.model ?? source!.model,
        reasoningEffort: body.reasoning_effort ?? source?.reasoningEffort ?? 'none',
        maxOutputTokens: body.max_output_tokens ?? source!.maxOutputTokens,
        systemPrompt: body.system_prompt ?? source!.systemPrompt,
        guidance: parseGuidance(body.guidance ?? source?.guidance),
        outputSchema: (source?.outputSchema as Record<string, unknown> | undefined) ?? {
          type: 'object',
          additionalProperties: false,
          required: ['review_text', 'used_context_terms', 'claim_risk', 'internal_quality_notes'],
          properties: {
            review_text: { type: 'string' },
            used_context_terms: { type: 'array', items: { type: 'string' } },
            claim_risk: { type: 'string', enum: ['low', 'medium', 'high'] },
            internal_quality_notes: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    });
    return NextResponse.json(toWire(created), { status: 201 });
  } catch (error) {
    const response = promptVersionErrorResponse(error);
    if (response) return response;
    throw error;
  }
}

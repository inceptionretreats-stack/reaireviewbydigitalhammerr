import { NextResponse } from 'next/server';
import { promptVersionDraftInput } from '@ai-review/contracts';
import { PromptVersionService } from '@ai-review/core';
import { db } from '@/lib/db';
import { apiError } from '@/lib/api-error';
import { readJsonObject } from '@/lib/request-body';
import { requireAdmin } from '@/lib/require-admin';
import { promptVersionErrorResponse, toFields, toWire } from '@/lib/admin/prompt-versions';

export const runtime = 'nodejs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  if (!UUID.test(id)) return apiError('RESOURCE_NOT_FOUND', 'No such prompt version.');
  const row = await new PromptVersionService(db()).get(id);
  if (!row) return apiError('RESOURCE_NOT_FOUND', 'No such prompt version.');
  return NextResponse.json(toWire(row));
}

/** Edits a DRAFT. The full field set is sent every time — a draft is small, and partial merges hide mistakes. */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  if (!UUID.test(id)) return apiError('RESOURCE_NOT_FOUND', 'No such prompt version.');

  const rawResult = await readJsonObject(request);
  if (!rawResult.ok) return rawResult.response;
  const raw = rawResult.body;
  const parsed = promptVersionDraftInput.safeParse(raw);
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
  const existing = await service.get(id);
  if (!existing) return apiError('RESOURCE_NOT_FOUND', 'No such prompt version.');

  try {
    const updated = await service.updateDraft(id, {
      actor: auth.context.actor,
      fields: toFields(parsed.data, existing.outputSchema as Record<string, unknown>),
    });
    return NextResponse.json(toWire(updated));
  } catch (error) {
    const response = promptVersionErrorResponse(error);
    if (response) return response;
    throw error;
  }
}

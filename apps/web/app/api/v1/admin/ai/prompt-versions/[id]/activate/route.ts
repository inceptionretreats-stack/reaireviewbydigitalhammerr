import { NextResponse } from 'next/server';
import { promptVersionAction } from '@ai-review/contracts';
import { AuditReasonRequiredError, PromptVersionService } from '@ai-review/core';
import { db } from '@/lib/db';
import { apiError } from '@/lib/api-error';
import { requireAdmin } from '@/lib/require-admin';
import { promptVersionErrorResponse, toWire } from '@/lib/admin/prompt-versions';

export const runtime = 'nodejs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ADMIN-03 "activate". High-risk: a reason is required and the change is audited. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  if (!UUID.test(id)) return apiError('RESOURCE_NOT_FOUND', 'No such prompt version.');

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return apiError('VALIDATION_FAILED', 'Malformed request body.');
  }
  const parsed = promptVersionAction.safeParse(raw);
  if (!parsed.success) {
    return apiError(
      'ADMIN_REASON_REQUIRED',
      'A reason is required; it is written to the audit log.',
    );
  }

  try {
    const row = await new PromptVersionService(db()).activate(id, {
      actor: auth.context.actor,
      reason: parsed.data.reason,
    });
    return NextResponse.json(toWire(row));
  } catch (error) {
    if (error instanceof AuditReasonRequiredError) {
      return apiError(
        'ADMIN_REASON_REQUIRED',
        'A reason is required; it is written to the audit log.',
      );
    }
    const response = promptVersionErrorResponse(error);
    if (response) return response;
    throw error;
  }
}

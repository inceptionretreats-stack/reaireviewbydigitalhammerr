import { NextResponse } from 'next/server';
import { adminMfaReset } from '@ai-review/contracts';
import { apiError } from '@/lib/api-error';
import { mfaService } from '@/lib/mfa';
import { requireAdmin } from '@/lib/require-admin';
import { teamService } from '@/lib/admin/team';

export const runtime = 'nodejs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/v1/admin/team/{id}/mfa/reset — another admin lost their phone (AMENDMENT-027).
 * Clears their authenticator and recovery codes and signs them out everywhere; their next
 * sign-in enrols again. High-risk and step-up; never for one's own account (use a recovery code).
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(request, { stepUp: true });
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  if (!UUID.test(id)) return apiError('RESOURCE_NOT_FOUND', 'No such team member.');
  if (id === auth.context.actor.userId) {
    return apiError('VALIDATION_FAILED', 'Use a recovery code for your own account.', {
      details: { fields: ['id'] },
    });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return apiError('VALIDATION_FAILED', 'Malformed request body.');
  }
  const parsed = adminMfaReset.safeParse(raw);
  if (!parsed.success) {
    return apiError('ADMIN_REASON_REQUIRED', 'Give a reason — it is written to the audit log.', {
      details: { fields: ['reason'] },
    });
  }

  const member = await teamService().get(id);
  if (!member) return apiError('RESOURCE_NOT_FOUND', 'No such team member.');

  await mfaService().reset(id, { actor: auth.context.actor, reason: parsed.data.reason });
  return NextResponse.json({ id, mfa_enabled_at: null });
}

import { NextResponse } from 'next/server';
import { adminTeamAction } from '@ai-review/contracts';
import { apiError } from '@/lib/api-error';
import { readJsonObject } from '@/lib/request-body';
import { requireAdmin } from '@/lib/require-admin';
import { teamErrorResponse, teamService } from '@/lib/admin/team';

export const runtime = 'nodejs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * PATCH /api/v1/admin/team/{id} — change role, disable, enable (AMENDMENT-027). Every action is
 * high-risk: reason required, step-up demanded, audited against the target account.
 */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(request, { stepUp: true });
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  if (!UUID.test(id)) return apiError('RESOURCE_NOT_FOUND', 'No such team member.');

  const rawResult = await readJsonObject(request);
  if (!rawResult.ok) return rawResult.response;
  const raw = rawResult.body;
  const parsed = adminTeamAction.safeParse(raw);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? 'body')))];
    if (fields.includes('reason')) {
      return apiError('ADMIN_REASON_REQUIRED', 'Give a reason — it is written to the audit log.', {
        details: { fields },
      });
    }
    return apiError('VALIDATION_FAILED', 'Please check the details you entered.', {
      details: { fields },
    });
  }

  const action = { actor: auth.context.actor, reason: parsed.data.reason };
  try {
    switch (parsed.data.action) {
      case 'change_role':
        await teamService().changeRole(id, { ...action, role: parsed.data.role });
        break;
      case 'disable':
        await teamService().disable(id, action);
        break;
      case 'enable':
        await teamService().enable(id, action);
        break;
    }
  } catch (error) {
    const response = teamErrorResponse(error);
    if (response) return response;
    throw error;
  }
  const member = await teamService().get(id);
  return NextResponse.json({
    id,
    role: member?.role ?? null,
    disabled_at: member?.disabledAt?.toISOString() ?? null,
  });
}

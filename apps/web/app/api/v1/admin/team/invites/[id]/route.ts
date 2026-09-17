import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAdmin } from '@/lib/require-admin';
import { teamErrorResponse, teamService } from '@/lib/admin/team';

export const runtime = 'nodejs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** DELETE /api/v1/admin/team/invites/{id} — withdraw a live invitation (AMENDMENT-027). */
export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  if (!UUID.test(id)) return apiError('RESOURCE_NOT_FOUND', 'No such invitation.');

  try {
    await teamService().revokeInvite(id, {
      actor: auth.context.actor,
      reason: 'Withdrawn from the team screen',
    });
  } catch (error) {
    const response = teamErrorResponse(error);
    if (response) return response;
    throw error;
  }
  return new NextResponse(null, { status: 204 });
}

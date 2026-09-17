import { NextResponse } from 'next/server';
import { adminTeamInvite } from '@ai-review/contracts';
import { apiError } from '@/lib/api-error';
import { env } from '@/lib/env';
import { adminInviteEmail } from '@/lib/email-templates';
import { mailer } from '@/lib/mailer';
import { requireAdmin } from '@/lib/require-admin';
import { inviteUrl, teamErrorResponse, teamService } from '@/lib/admin/team';

export const runtime = 'nodejs';

/** GET /api/v1/admin/team — members and live invites. Super-admin only (05_RBAC). */
export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;
  const { members, invites } = await teamService().list();
  return NextResponse.json({
    members: members.map((m) => ({
      id: m.id,
      email: m.email,
      full_name: m.fullName,
      role: m.role,
      mfa_enabled_at: m.mfaEnabledAt?.toISOString() ?? null,
      last_login_at: m.lastLoginAt?.toISOString() ?? null,
      disabled_at: m.disabledAt?.toISOString() ?? null,
      created_at: m.createdAt.toISOString(),
    })),
    invites: invites.map((i) => ({
      id: i.id,
      email: i.email,
      full_name: i.fullName,
      role: i.role,
      expires_at: i.expiresAt.toISOString(),
      created_at: i.createdAt.toISOString(),
    })),
  });
}

/**
 * POST /api/v1/admin/team — invite an admin or support viewer (AMENDMENT-027). High-risk:
 * reason required, step-up demanded. The link goes by email; outside production it is also
 * returned so the invitation works before a mail provider exists.
 */
export async function POST(request: Request) {
  const auth = await requireAdmin(request, { stepUp: true });
  if (!auth.ok) return auth.response;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return apiError('VALIDATION_FAILED', 'Malformed request body.');
  }
  const parsed = adminTeamInvite.safeParse(raw);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? 'body')))];
    return apiError('VALIDATION_FAILED', parsed.error.issues[0]?.message ?? 'Check the details.', {
      details: { fields },
    });
  }

  try {
    const invite = await teamService().invite({
      actor: auth.context.actor,
      reason: parsed.data.reason,
      email: parsed.data.email,
      fullName: parsed.data.full_name,
      role: parsed.data.role,
    });
    const url = inviteUrl(invite.token);
    let emailed = true;
    try {
      await mailer().send(
        adminInviteEmail(parsed.data.email, {
          inviterName: 'A platform admin',
          role: parsed.data.role,
          inviteUrl: url,
          expiresAt: invite.expiresAt,
        }),
      );
    } catch {
      emailed = false;
    }
    return NextResponse.json(
      {
        invite_id: invite.inviteId,
        expires_at: invite.expiresAt.toISOString(),
        emailed,
        ...(env().NODE_ENV !== 'production' || !emailed ? { invite_url: url } : {}),
      },
      { status: 201 },
    );
  } catch (error) {
    const response = teamErrorResponse(error);
    if (response) return response;
    throw error;
  }
}

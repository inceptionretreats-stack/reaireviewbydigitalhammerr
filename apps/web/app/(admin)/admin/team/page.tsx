import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { TeamScreen } from '@/components/admin/TeamScreen';
import { adminDateTime } from '@/lib/admin/format';
import { teamService } from '@/lib/admin/team';
import { getSession } from '@/lib/auth/session';

export const metadata: Metadata = { title: 'Team | Ai Review admin' };
export const dynamic = 'force-dynamic';

/** AMENDMENT-027 — who can administer the platform. Super-admin only; a viewer is sent back. */
export default async function Page() {
  const session = await getSession();
  if (!session || session.role !== 'SUPER_ADMIN') redirect('/admin');

  const { members, invites } = await teamService().list();
  return (
    <div className="stack">
      <div>
        <p className="text-xs font-semibold tracking-wider text-ink-muted uppercase">
          Platform admin
        </p>
        <h1 className="text-2xl font-bold tracking-tight text-ink">Team</h1>
      </div>
      <TeamScreen
        selfId={session.userId}
        members={members.map((m) => ({
          id: m.id,
          email: m.email,
          full_name: m.fullName,
          role: m.role,
          mfa_enabled_at: m.mfaEnabledAt?.toISOString() ?? null,
          last_login_at: m.lastLoginAt?.toISOString() ?? null,
          disabled_at: m.disabledAt?.toISOString() ?? null,
          created_at: m.createdAt.toISOString(),
          last_login_label: adminDateTime(m.lastLoginAt),
          mfa_label: m.mfaEnabledAt
            ? `Enrolled ${adminDateTime(m.mfaEnabledAt)}`
            : 'Not enrolled yet',
        }))}
        invites={invites.map((i) => ({
          id: i.id,
          email: i.email,
          full_name: i.fullName,
          role: i.role,
          expires_label: adminDateTime(i.expiresAt),
        }))}
      />
    </div>
  );
}

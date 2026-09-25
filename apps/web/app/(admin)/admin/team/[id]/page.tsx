import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { and, desc, eq } from 'drizzle-orm';
import { adminAuditLogs, users } from '@ai-review/db';
import { Badge, Card, Table } from '@ai-review/ui';
import { adminDateTime } from '@/lib/admin/format';
import { teamService } from '@/lib/admin/team';
import { db } from '@/lib/infra/db';
import { getSession } from '@/lib/auth/session';

export const metadata: Metadata = { title: 'Team member | Ai Review admin' };
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * AMENDMENT-027 — one admin: who they are, their MFA state, and every audit row that was
 * written about them (role changes, resets, disables) or by them.
 */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.role !== 'SUPER_ADMIN') redirect('/admin');
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const member = await teamService().get(id);
  if (!member) notFound();

  const database = db();
  const [about, by] = await Promise.all([
    database
      .select({
        id: adminAuditLogs.id,
        action: adminAuditLogs.action,
        reason: adminAuditLogs.reason,
        createdAt: adminAuditLogs.createdAt,
        actorEmail: users.email,
        actorType: adminAuditLogs.actorType,
      })
      .from(adminAuditLogs)
      .leftJoin(users, eq(users.id, adminAuditLogs.actorUserId))
      .where(and(eq(adminAuditLogs.targetType, 'user'), eq(adminAuditLogs.targetId, id)))
      .orderBy(desc(adminAuditLogs.id))
      .limit(50),
    database
      .select({
        id: adminAuditLogs.id,
        action: adminAuditLogs.action,
        reason: adminAuditLogs.reason,
        createdAt: adminAuditLogs.createdAt,
        targetType: adminAuditLogs.targetType,
        targetId: adminAuditLogs.targetId,
      })
      .from(adminAuditLogs)
      .where(eq(adminAuditLogs.actorUserId, id))
      .orderBy(desc(adminAuditLogs.id))
      .limit(50),
  ]);

  return (
    <div className="stack">
      <div>
        <p className="text-xs font-semibold tracking-wider text-ink-muted uppercase">
          <Link href="/admin/team">Team</Link> / {member.fullName}
        </p>
        <h1 className="flex flex-wrap items-center gap-3 text-2xl font-bold tracking-tight text-ink">
          {member.fullName}
          <Badge tone={member.role === 'SUPER_ADMIN' ? 'accent' : 'neutral'}>
            {member.role === 'SUPER_ADMIN' ? 'Platform admin' : 'Support viewer'}
          </Badge>
          {member.disabledAt && <Badge tone="danger">Disabled</Badge>}
        </h1>
        <p className="text-sm text-ink-muted">{member.email}</p>
      </div>

      <Card title="Account" titleAs="h2">
        <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-6 gap-y-2 text-sm">
          <dt className="text-ink-muted">Authenticator</dt>
          <dd>
            {member.mfaEnabledAt
              ? `Enrolled ${adminDateTime(member.mfaEnabledAt)}`
              : 'Not enrolled yet'}
          </dd>
          <dt className="text-ink-muted">Last sign-in</dt>
          <dd>{adminDateTime(member.lastLoginAt)}</dd>
          <dt className="text-ink-muted">Member since</dt>
          <dd>{adminDateTime(member.createdAt)}</dd>
          {member.disabledAt && (
            <>
              <dt className="text-ink-muted">Disabled</dt>
              <dd>
                {adminDateTime(member.disabledAt)}
                {member.disabledReason ? ` — ${member.disabledReason}` : ''}
              </dd>
            </>
          )}
        </dl>
      </Card>

      <Card title="Changes to this account" titleAs="h2">
        <Table
          caption="Audit rows about this account"
          columns={[
            { key: 'when', header: 'When', cell: (e) => adminDateTime(e.createdAt) },
            {
              key: 'who',
              header: 'By',
              cell: (e) => (e.actorType === 'SYSTEM' ? 'system' : (e.actorEmail ?? 'unknown')),
            },
            { key: 'action', header: 'Action', cell: (e) => <code>{e.action}</code> },
            { key: 'reason', header: 'Reason', cell: (e) => e.reason ?? '—' },
          ]}
          rows={about}
          rowKey={(e) => String(e.id)}
          empty={<p className="text-sm text-ink-muted">Nothing yet.</p>}
        />
      </Card>

      <Card title="Actions taken by this account" titleAs="h2">
        <Table
          caption="Audit rows written by this account"
          columns={[
            { key: 'when', header: 'When', cell: (e) => adminDateTime(e.createdAt) },
            { key: 'action', header: 'Action', cell: (e) => <code>{e.action}</code> },
            {
              key: 'target',
              header: 'Target',
              cell: (e) => (e.targetType ? `${e.targetType} ${e.targetId ?? ''}` : '—'),
            },
            { key: 'reason', header: 'Reason', cell: (e) => e.reason ?? '—' },
          ]}
          rows={by}
          rowKey={(e) => String(e.id)}
          empty={<p className="text-sm text-ink-muted">Nothing yet.</p>}
        />
      </Card>
    </div>
  );
}

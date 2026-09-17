import type { Metadata } from 'next';
import Link from 'next/link';
import { desc, eq, lt } from 'drizzle-orm';
import { adminAuditLogs, businesses, users } from '@ai-review/db';
import { Table } from '@ai-review/ui';
import { db } from '@/lib/db';
import { adminDateTime } from '@/lib/admin/format';

export const metadata: Metadata = { title: 'Audit log | Ai Review admin' };
export const dynamic = 'force-dynamic';

/** E12-07. Newest first, keyset paged; rows are never edited or deleted (AC-029). */
export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = (await searchParams)['before'];
  const before = Number(Array.isArray(raw) ? raw[0] : raw);
  const rows = await db()
    .select({
      id: adminAuditLogs.id,
      action: adminAuditLogs.action,
      reason: adminAuditLogs.reason,
      createdAt: adminAuditLogs.createdAt,
      actorEmail: users.email,
      actorType: adminAuditLogs.actorType,
      businessId: adminAuditLogs.businessId,
      businessName: businesses.name,
    })
    .from(adminAuditLogs)
    .leftJoin(users, eq(users.id, adminAuditLogs.actorUserId))
    .leftJoin(businesses, eq(businesses.id, adminAuditLogs.businessId))
    .where(Number.isInteger(before) && before > 0 ? lt(adminAuditLogs.id, before) : undefined)
    .orderBy(desc(adminAuditLogs.id))
    .limit(50);
  const last = rows[rows.length - 1];

  return (
    <div className="stack">
      <header>
        <p className="text-sm text-ink-muted">Admin</p>
        <h1>Audit log</h1>
        <p className="text-ink-muted">
          Every admin action, with who, when and why. Nothing here can be edited.
        </p>
      </header>
      <Table
        caption="Audit entries"
        columns={[
          {
            key: 'when',
            header: 'When',
            cell: (e) => adminDateTime(e.createdAt),
          },
          {
            key: 'who',
            header: 'Who',
            cell: (e) => (e.actorType === 'SYSTEM' ? 'system' : (e.actorEmail ?? 'unknown')),
          },
          { key: 'action', header: 'Action', cell: (e) => <code>{e.action}</code> },
          {
            key: 'business',
            header: 'Business',
            cell: (e) =>
              e.businessId ? (
                <Link href={`/admin/businesses/${e.businessId}`}>
                  {e.businessName ?? e.businessId}
                </Link>
              ) : (
                '—'
              ),
          },
          { key: 'reason', header: 'Reason', cell: (e) => e.reason ?? '—' },
        ]}
        rows={rows}
        rowKey={(e) => String(e.id)}
        stackOnMobile
        empty={<p className="text-sm text-ink-muted">No admin actions recorded yet.</p>}
      />
      {rows.length === 50 && last && (
        <Link href={`/admin/audit?before=${last.id}`} className="text-sm">
          Older entries →
        </Link>
      )}
    </div>
  );
}

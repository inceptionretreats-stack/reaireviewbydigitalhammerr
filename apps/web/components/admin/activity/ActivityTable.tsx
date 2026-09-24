import Link from 'next/link';
import { Badge, Table } from '@ai-review/ui';
import { adminDateTime } from '@/lib/admin/format';

/**
 * AMENDMENT-028 — one row per thing a signed-in person did. Shared by the explorer, the
 * business detail page and the team member page; a server component, so the dates are
 * formatted in the platform timezone before they reach the browser.
 */
export interface ActivityRowView {
  id: number;
  occurredAt: Date;
  userEmail: string | null;
  businessId: string | null;
  businessName: string | null;
  action: string;
  outcome: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown>;
  ipHash: string | null;
}

export function ActivityTable({
  rows,
  showBusiness = true,
  caption = 'Activity',
}: {
  rows: ActivityRowView[];
  showBusiness?: boolean;
  caption?: string;
}) {
  return (
    <Table
      caption={caption}
      columns={[
        {
          key: 'when',
          header: 'When',
          isRowHeader: true,
          cell: (r) => adminDateTime(r.occurredAt),
        },
        { key: 'who', header: 'Who', cell: (r) => r.userEmail ?? 'signed-out visitor' },
        ...(showBusiness
          ? [
              {
                key: 'business',
                header: 'Business',
                cell: (r: ActivityRowView) =>
                  r.businessId ? (
                    <Link href={`/admin/businesses/${r.businessId}`}>
                      {r.businessName ?? r.businessId}
                    </Link>
                  ) : (
                    '—'
                  ),
              },
            ]
          : []),
        { key: 'action', header: 'Action', cell: (r) => <code>{r.action}</code> },
        {
          key: 'outcome',
          header: 'Outcome',
          cell: (r) =>
            r.outcome === 'SUCCESS' ? (
              <Badge tone="success">OK</Badge>
            ) : r.outcome === 'DENIED' ? (
              <Badge tone="warning">Denied</Badge>
            ) : (
              <Badge tone="danger">Failed</Badge>
            ),
        },
        {
          key: 'target',
          header: 'Target',
          cell: (r) =>
            r.targetType ? `${r.targetType} ${r.targetId ? r.targetId.slice(0, 8) : ''}` : '—',
        },
        {
          key: 'details',
          header: 'Details',
          cell: (r) => {
            const entries = Object.entries(r.metadata);
            if (entries.length === 0) return <span className="text-ink-muted">—</span>;
            return (
              <ul className="text-xs text-ink-muted">
                {entries.slice(0, 6).map(([k, v]) => (
                  <li key={k}>
                    {k}: {typeof v === 'string' ? v : JSON.stringify(v)}
                  </li>
                ))}
              </ul>
            );
          },
        },
        {
          key: 'ip',
          header: 'Network',
          cell: (r) =>
            r.ipHash ? <code title="Hashed address">{r.ipHash.slice(0, 10)}…</code> : '—',
        },
      ]}
      rows={rows}
      rowKey={(r) => String(r.id)}
      empty={<p className="text-sm text-ink-muted">Nothing recorded yet.</p>}
    />
  );
}

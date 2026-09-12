import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge, Card, Table } from '@ai-review/ui';
import { db } from '@/lib/db';
import { getBusinessDetail } from '@/lib/admin/businesses';
import { BusinessActions } from '@/components/admin/BusinessActions';
import { PlanBadge } from '@/components/admin/PlanBadge';
import { adminDateTime } from '@/lib/admin/format';

export const metadata: Metadata = { title: 'Business | Ai Review admin' };
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const when = adminDateTime;
const rupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN')}`;

/** ADMIN-02 detail: overview, owner, subscription with actions, payments, audit history. */
export default async function AdminBusinessPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const b = await getBusinessDetail(db(), id);
  if (!b) notFound();

  return (
    <div className="stack">
      <header>
        <p className="text-sm text-ink-muted">
          <Link href="/admin/businesses">Businesses</Link> / {b.name}
        </p>
        <h1 className="flex flex-wrap items-center gap-3">
          {b.name}
          <Badge
            tone={
              b.status === 'ACTIVE' ? 'success' : b.status === 'SUSPENDED' ? 'danger' : 'neutral'
            }
          >
            {b.status}
          </Badge>
          <PlanBadge row={b} />
        </h1>
        <p className="text-ink-muted">
          {b.category}
          {b.city ? ` · ${b.city}` : ''} · joined {when(b.createdAt)}
          {b.slug && (
            <>
              {' '}
              ·{' '}
              <a href={`/${b.slug}`} target="_blank" rel="noopener noreferrer">
                /{b.slug}
              </a>
            </>
          )}
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Owner" titleAs="h2">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-ink-muted">Name</dt>
            <dd>{b.ownerName}</dd>
            <dt className="text-ink-muted">Email</dt>
            <dd>{b.ownerEmail}</dd>
            <dt className="text-ink-muted">Custom domain</dt>
            <dd>{b.domain ?? '—'}</dd>
          </dl>
        </Card>

        <Card title="Usage" titleAs="h2">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-ink-muted">Ai drafts, all time</dt>
            <dd>{b.generationsTotal}</dd>
            <dt className="text-ink-muted">Ai drafts, 30 days</dt>
            <dd>{b.generations30d}</dd>
            <dt className="text-ink-muted">QR scans, 30 days</dt>
            <dd>{b.scans30d}</dd>
          </dl>
        </Card>
      </div>

      <Card title="Subscription" titleAs="h2">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-ink-muted">Plan</dt>
          <dd>
            <PlanBadge row={b} />
          </dd>
          <dt className="text-ink-muted">Status</dt>
          <dd>{b.subscriptionStatus}</dd>
          <dt className="text-ink-muted">Period</dt>
          <dd>{b.startsAt ? `${when(b.startsAt)} → ${when(b.expiresAt)}` : 'No paid period'}</dd>
          <dt className="text-ink-muted">Free allowance</dt>
          <dd>
            {b.freeUsed} of {b.freeLimit} lifetime drafts used
          </dd>
          <dt className="text-ink-muted">Pro allowance</dt>
          <dd>
            {b.proUsed} of {b.proLimit} this year
          </dd>
          <dt className="text-ink-muted">Price on file</dt>
          <dd>{rupees(b.amountPaise)} per year</dd>
          {b.entitlementSource === 'ADMIN' && (
            <>
              <dt className="text-ink-muted">Granted by</dt>
              <dd>
                {b.grantedByEmail ?? 'an admin'}
                {b.entitlementNote ? ` — ${b.entitlementNote}` : ''}
              </dd>
            </>
          )}
        </dl>
      </Card>

      <BusinessActions
        businessId={b.id}
        status={b.status}
        plan={b.plan}
        freeLimit={b.freeLimit}
        freeUsed={b.freeUsed}
      />

      <Table
        caption="Payments"
        captionVisible
        columns={[
          { key: 'when', header: 'When', cell: (p) => when(p.paidAt ?? p.createdAt) },
          { key: 'amount', header: 'Amount', cell: (p) => rupees(p.amountPaise) },
          {
            key: 'status',
            header: 'Status',
            cell: (p) => (
              <Badge
                tone={
                  p.status === 'CAPTURED' ? 'success' : p.status === 'FAILED' ? 'danger' : 'neutral'
                }
              >
                {p.status}
              </Badge>
            ),
          },
          { key: 'ref', header: 'Razorpay payment', cell: (p) => p.providerPaymentId ?? '—' },
        ]}
        rows={b.payments}
        rowKey={(p) => p.id}
        stackOnMobile
        empty={<p className="text-sm text-ink-muted">No payments yet.</p>}
      />

      <Table
        caption="Audit history"
        captionVisible
        columns={[
          { key: 'when', header: 'When', cell: (e) => when(e.createdAt) },
          { key: 'who', header: 'Who', cell: (e) => e.actorEmail ?? 'unknown' },
          { key: 'action', header: 'Action', cell: (e) => <code>{e.action}</code> },
          { key: 'reason', header: 'Reason', cell: (e) => e.reason ?? '—' },
          {
            key: 'change',
            header: 'Change',
            cell: (e) => <ChangeSummary before={e.before} after={e.after} />,
          },
        ]}
        rows={b.audit}
        rowKey={(e) => String(e.id)}
        stackOnMobile
        empty={<p className="text-sm text-ink-muted">No admin actions on this business yet.</p>}
      />
    </div>
  );
}

/** Only the keys that changed, so a row reads as "status: FREE → PRO_ACTIVE". */
function ChangeSummary({ before, after }: { before: unknown; after: unknown }) {
  if (!isRecord(before) || !isRecord(after)) return <span className="text-ink-muted">—</span>;
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
    (k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]),
  );
  if (keys.length === 0) return <span className="text-ink-muted">no change</span>;
  return (
    <ul className="text-xs">
      {keys.map((k) => (
        <li key={k}>
          <code>{k}</code>: {show(before[k])} → {show(after[k])}
        </li>
      ))}
    </ul>
  );
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function show(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return when(new Date(v));
  return String(v);
}

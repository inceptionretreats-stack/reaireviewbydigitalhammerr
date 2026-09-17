import type { Metadata } from 'next';
import Link from 'next/link';
import { adminBusinessListQuery } from '@ai-review/contracts';
import { Badge, Button, Card, Input, Select, Table, EmptyState } from '@ai-review/ui';
import { db } from '@/lib/db';
import { listBusinesses, type AdminBusinessRow } from '@/lib/admin/businesses';
import { PlanBadge } from '@/components/admin/PlanBadge';
import { adminDate } from '@/lib/admin/format';

export const metadata: Metadata = { title: 'Businesses | Ai Review admin' };
export const dynamic = 'force-dynamic';

/**
 * ADMIN-02 list. A plain GET form for the filters — the URL is the state, so a filtered view can
 * be bookmarked or pasted to a colleague, and the page works before any script runs.
 */
export default async function AdminBusinessesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = Object.fromEntries(
    Object.entries(await searchParams).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]),
  );
  const parsed = adminBusinessListQuery.safeParse(raw);
  const query = parsed.success ? parsed.data : adminBusinessListQuery.parse({});
  const page = await listBusinesses(db(), query);
  const pages = Math.max(1, Math.ceil(page.total / page.pageSize));
  const link = (p: number) => {
    const params = new URLSearchParams();
    if (query.q) params.set('q', query.q);
    if (query.plan) params.set('plan', query.plan);
    if (query.status) params.set('status', query.status);
    if (query.expiring) params.set('expiring', 'true');
    if (query.high_ai) params.set('high_ai', 'true');
    if (query.ai_limited) params.set('ai_limited', 'true');
    params.set('page', String(p));
    return `/admin/businesses?${params}`;
  };

  const columns = [
    {
      key: 'business',
      header: 'Business',
      cell: (row: AdminBusinessRow) => (
        <div>
          <Link href={`/admin/businesses/${row.id}`} className="font-semibold">
            {row.name}
          </Link>
          <div className="text-xs text-ink-muted">
            {row.slug ? `/${row.slug}` : 'no slug yet'} · {row.category}
            {row.city ? ` · ${row.city}` : ''}
          </div>
        </div>
      ),
    },
    {
      key: 'owner',
      header: 'Owner',
      cell: (row: AdminBusinessRow) => (
        <div>
          {row.ownerEmail}
          {row.ownerMobile && <div className="text-xs text-ink-muted">{row.ownerMobile}</div>}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (row: AdminBusinessRow) => (
        <div className="flex flex-wrap gap-1">
          <Badge
            tone={
              row.status === 'ACTIVE'
                ? 'success'
                : row.status === 'SUSPENDED'
                  ? 'danger'
                  : 'neutral'
            }
          >
            {row.status}
          </Badge>
          {row.aiSuspendedAt && <Badge tone="danger">Ai off</Badge>}
          {row.aiThrottleUntil && row.aiThrottleUntil > new Date() && (
            <Badge tone="warning">throttled</Badge>
          )}
        </div>
      ),
    },
    {
      key: 'domain',
      header: 'Custom domain',
      cell: (row: AdminBusinessRow) => row.domain ?? '—',
    },
    { key: 'plan', header: 'Plan', cell: (row: AdminBusinessRow) => <PlanBadge row={row} /> },
    {
      key: 'usage',
      header: 'Ai drafts',
      cell: (row: AdminBusinessRow) =>
        row.plan === 'PRO'
          ? `${row.proUsed} / ${row.proLimit} this year`
          : `${row.freeUsed} / ${row.freeLimit} free`,
    },
    {
      key: 'expires',
      header: 'Pro until',
      cell: (row: AdminBusinessRow) => adminDate(row.expiresAt),
    },
    {
      key: 'created',
      header: 'Joined',
      cell: (row: AdminBusinessRow) => adminDate(row.createdAt),
    },
  ];

  return (
    <div className="stack">
      <header>
        <p className="text-sm text-ink-muted">Admin</p>
        <h1>Businesses</h1>
        <p className="text-ink-muted">
          {page.total.toLocaleString('en-IN')} business{page.total === 1 ? '' : 'es'}
          {query.q || query.plan || query.status || query.expiring ? ' match these filters' : ''}.
        </p>
      </header>

      <Card as="section" title="Find a business" titleAs="h2">
        <form
          method="get"
          action="/admin/businesses"
          className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_auto_auto] sm:items-end"
        >
          <label className="stack text-sm">
            <span>Name, owner email or slug</span>
            <Input name="q" defaultValue={query.q ?? ''} placeholder="eats and treat" />
          </label>
          <label className="stack text-sm">
            <span>Plan</span>
            <Select
              name="plan"
              defaultValue={query.plan ?? ''}
              options={[
                { value: '', label: 'Any' },
                { value: 'free', label: 'Free' },
                { value: 'pro', label: 'Pro' },
              ]}
            />
          </label>
          <label className="stack text-sm">
            <span>Status</span>
            <Select
              name="status"
              defaultValue={query.status ?? ''}
              options={[
                { value: '', label: 'Any' },
                { value: 'ACTIVE', label: 'Active' },
                { value: 'DRAFT', label: 'Draft' },
                { value: 'SUSPENDED', label: 'Suspended' },
                { value: 'CLOSED', label: 'Closed' },
              ]}
            />
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" name="expiring" value="true" defaultChecked={!!query.expiring} />
            Expiring in 30 days
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" name="high_ai" value="true" defaultChecked={!!query.high_ai} />
            High Ai usage (24 h)
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="ai_limited"
              value="true"
              defaultChecked={!!query.ai_limited}
            />
            Ai suspended or throttled
          </label>
          <Button type="submit" variant="secondary">
            Filter
          </Button>
        </form>
      </Card>

      <Table
        caption="Businesses"
        columns={columns}
        rows={page.rows}
        rowKey={(row) => row.id}
        stackOnMobile
        empty={<EmptyState title="No businesses match" description="Try fewer filters." />}
      />

      {pages > 1 && (
        <nav aria-label="Pages" className="flex items-center gap-3 text-sm">
          {page.page > 1 && <Link href={link(page.page - 1)}>← Previous</Link>}
          <span className="text-ink-muted">
            Page {page.page} of {pages}
          </span>
          {page.page < pages && <Link href={link(page.page + 1)}>Next →</Link>}
        </nav>
      )}
    </div>
  );
}

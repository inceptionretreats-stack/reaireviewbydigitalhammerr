import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge } from '@ai-review/ui';
import { db } from '@/lib/infra/db';
import { getBusinessDetail } from '@/lib/admin/businesses';
import { getSession } from '@/lib/auth/session';
import { PlanBadge } from '@/components/admin/PlanBadge';
import { adminDateTime } from '@/lib/admin/format';
import {
  ActivityTab,
  AiTab,
  AnalyticsTab,
  AuditTab,
  BillingTab,
  BUSINESS_TABS,
  DomainTab,
  isBusinessTab,
  OverviewTab,
  OwnerTab,
  ProfileTab,
  QrTab,
  UsageTab,
  type BusinessTab,
} from '@/components/admin/businesses/BusinessTabs';

export const metadata: Metadata = { title: 'Business | Ai Review admin' };
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * ADMIN-02 detail, as the spec's eleven tabs (19_Admin_Panel_Spec L56-66). `?tab=` picks one;
 * the URL is the state so a tab can be linked. Each tab loads only its own data.
 */
export default async function AdminBusinessPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const database = db();
  const b = await getBusinessDetail(database, id);
  if (!b) notFound();
  const session = await getSession();
  const canAct = session?.role === 'SUPER_ADMIN';
  const raw = (await searchParams)['tab'];
  const requested = Array.isArray(raw) ? raw[0] : raw;
  const tab: BusinessTab = isBusinessTab(requested) ? requested : 'overview';

  const props = { db: database, b, canAct };
  const body = {
    overview: <OverviewTab {...props} />,
    owner: <OwnerTab {...props} />,
    profile: <ProfileTab {...props} />,
    ai: <AiTab {...props} />,
    qr: <QrTab {...props} />,
    analytics: <AnalyticsTab {...props} />,
    billing: <BillingTab {...props} />,
    domain: <DomainTab {...props} />,
    usage: <UsageTab {...props} />,
    activity: <ActivityTab {...props} />,
    audit: <AuditTab {...props} />,
  }[tab];

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
          {b.city ? ` · ${b.city}` : ''} · joined {adminDateTime(b.createdAt)}
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

      <nav aria-label="Business sections" className="overflow-x-auto">
        <ul className="flex min-w-max gap-1 border-b border-border">
          {BUSINESS_TABS.map((t) => (
            <li key={t.key}>
              <Link
                href={
                  t.key === 'overview'
                    ? `/admin/businesses/${id}`
                    : `/admin/businesses/${id}?tab=${t.key}`
                }
                aria-current={t.key === tab ? 'page' : undefined}
                className={`inline-block border-b-2 px-3 py-2 text-sm ${
                  t.key === tab
                    ? 'border-accent font-semibold text-ink'
                    : 'border-transparent text-ink-muted hover:text-ink'
                }`}
              >
                {t.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <section aria-label={BUSINESS_TABS.find((t) => t.key === tab)!.label}>{body}</section>
    </div>
  );
}

import Link from 'next/link';
import { Badge, Card, KpiCard, Table } from '@ai-review/ui';
import type { Database } from '@ai-review/db';
import type { AdminBusinessDetail } from '@/lib/admin/businesses';
import {
  loadAiSetup,
  loadDomains,
  loadFunnel,
  loadOwnerAccount,
  loadPublicProfile,
  loadQrSources,
  loadUsage,
} from '@/lib/admin/business-tab-loaders';
import { loadActivity } from '@/lib/admin/activity';
import { adminDateTime } from '@/lib/admin/format';
import { ActivityTable } from '@/components/admin/activity/ActivityTable';
import { BusinessActions } from '@/components/admin/businesses/BusinessActions';
import { PlanBadge } from '@/components/admin/PlanBadge';
import { AbuseActions } from '@/components/admin/businesses/AbuseActions';
import { SendPasswordResetButton } from '@/components/admin/businesses/SendPasswordResetButton';

/**
 * The tabs of the admin business page (19_Admin_Panel_Spec L56-66), each a server component
 * that loads only its own data. Order and names follow the spec's list.
 */
export const BUSINESS_TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'owner', label: 'Owner & account' },
  { key: 'profile', label: 'Public profile' },
  { key: 'ai', label: 'Ai context & modes' },
  { key: 'qr', label: 'QR sources' },
  { key: 'analytics', label: 'Analytics' },
  { key: 'billing', label: 'Subscription & payments' },
  { key: 'domain', label: 'Domain' },
  { key: 'usage', label: 'Usage & abuse' },
  { key: 'activity', label: 'Activity' },
  { key: 'audit', label: 'Audit' },
] as const;
export type BusinessTab = (typeof BUSINESS_TABS)[number]['key'];

export function isBusinessTab(value: string | undefined): value is BusinessTab {
  return BUSINESS_TABS.some((t) => t.key === value);
}

const when = adminDateTime;
const rupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN')}`;

interface TabProps {
  db: Database;
  b: AdminBusinessDetail;
  canAct: boolean;
}

export async function OverviewTab({ db, b, canAct }: TabProps) {
  const [funnel, usage] = await Promise.all([loadFunnel(db, b.id), loadUsage(db, b.id)]);
  const today = funnel.daily[funnel.daily.length - 1];
  return (
    <div className="stack">
      <section aria-label="Today and 30 days" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Ai drafts, 24 h"
          value={usage.last24h}
          hint={`${b.generations30d} in 30 days`}
        />
        <KpiCard
          label="QR scans, 30 days"
          value={funnel.scans}
          hint={`${today?.scans ?? 0} today`}
        />
        <KpiCard
          label="Google opens, 30 days"
          value={funnel.googleOpens}
          hint={`${today?.googleOpens ?? 0} today`}
        />
        <KpiCard label="Private feedback, 24 h" value={usage.feedback24h} />
      </section>
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
            <dt className="text-ink-muted">Allowance</dt>
            <dd>
              {b.plan === 'PRO'
                ? `${b.proUsed} of ${b.proLimit} this year`
                : `${b.freeUsed} of ${b.freeLimit} lifetime free drafts`}
            </dd>
          </dl>
        </Card>
      </div>
      {(usage.aiSuspendedAt || usage.aiThrottleUntil) && (
        <p
          role="status"
          className="rounded-card border border-warning bg-warning-soft px-4 py-3 text-sm"
        >
          {usage.aiSuspendedAt
            ? `Ai generation is suspended since ${when(usage.aiSuspendedAt)}: ${usage.aiSuspendedReason ?? 'no reason recorded'}.`
            : `Ai generation is throttled to ${usage.aiThrottlePerHour} an hour until ${when(usage.aiThrottleUntil!)}.`}{' '}
          <Link href={`/admin/businesses/${b.id}?tab=usage`}>Usage &amp; abuse →</Link>
        </p>
      )}
      {canAct && (
        <BusinessActions
          businessId={b.id}
          status={b.status}
          plan={b.plan}
          freeLimit={b.freeLimit}
          freeUsed={b.freeUsed}
        />
      )}
    </div>
  );
}

export async function OwnerTab({ db, b, canAct }: TabProps) {
  const owner = await loadOwnerAccount(db, b.id);
  if (!owner) return <p className="text-sm text-ink-muted">No owner account.</p>;
  return (
    <div className="stack">
      <Card title="Owner account" titleAs="h2">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-ink-muted">Name</dt>
          <dd>{owner.fullName}</dd>
          <dt className="text-ink-muted">Email</dt>
          <dd>
            {owner.email}{' '}
            {owner.emailVerifiedAt ? (
              <Badge tone="success">verified</Badge>
            ) : (
              <Badge tone="neutral">unverified</Badge>
            )}
          </dd>
          <dt className="text-ink-muted">Mobile</dt>
          <dd>{owner.mobile ?? '—'}</dd>
          <dt className="text-ink-muted">Signed up</dt>
          <dd>{when(owner.createdAt)}</dd>
          <dt className="text-ink-muted">Last sign-in</dt>
          <dd>{owner.lastLoginAt ? when(owner.lastLoginAt) : 'never'}</dd>
          <dt className="text-ink-muted">Live sessions</dt>
          <dd>{owner.liveSessions}</dd>
          <dt className="text-ink-muted">Failed sign-ins</dt>
          <dd>
            {owner.failedLoginCount}
            {owner.lockedUntil && owner.lockedUntil > new Date() && (
              <span className="text-danger"> · locked until {when(owner.lockedUntil)}</span>
            )}
          </dd>
          <dt className="text-ink-muted">MFA</dt>
          <dd className="text-ink-muted">Not offered to owners in this version.</dd>
          <dt className="text-ink-muted">Account</dt>
          <dd>
            {owner.disabledAt ? (
              <Badge tone="danger">disabled {when(owner.disabledAt)}</Badge>
            ) : (
              'enabled'
            )}
          </dd>
        </dl>
      </Card>
      {canAct && (
        <Card
          title="Help the owner in"
          titleAs="h2"
          description="Sends the same reset email the forgot-password screen does; audited."
        >
          <SendPasswordResetButton businessId={b.id} email={owner.email} />
        </Card>
      )}
    </div>
  );
}

export async function ProfileTab({ db, b }: TabProps) {
  const p = await loadPublicProfile(db, b.id);
  return (
    <div className="stack">
      <Card title="Public page" titleAs="h2">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-ink-muted">Published</dt>
          <dd>{p.publishedAt ? when(p.publishedAt) : 'not yet'}</dd>
          <dt className="text-ink-muted">Location</dt>
          <dd>{[p.city, p.state].filter(Boolean).join(', ') || '—'}</dd>
          <dt className="text-ink-muted">Timezone</dt>
          <dd>{p.timezone}</dd>
          <dt className="text-ink-muted">Description</dt>
          <dd className="whitespace-pre-line">{p.description || '—'}</dd>
          <dt className="text-ink-muted">Review destination</dt>
          <dd>
            {p.destination ? (
              <>
                <a
                  href={p.destination.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="break-all"
                >
                  {p.destination.url}
                </a>{' '}
                {p.destination.isEnabled ? (
                  <Badge tone="success">enabled</Badge>
                ) : (
                  <Badge tone="danger">disabled</Badge>
                )}
              </>
            ) : (
              'none'
            )}
          </dd>
        </dl>
      </Card>
      <Table
        caption="Slug history"
        captionVisible
        columns={[
          { key: 'slug', header: 'Slug', cell: (s) => <code>/{s.slug}</code> },
          {
            key: 'primary',
            header: 'Role',
            cell: (s) => (s.isPrimary ? <Badge tone="success">primary</Badge> : 'redirect'),
          },
          {
            key: 'until',
            header: 'Redirect until',
            cell: (s) => (s.redirectUntil ? when(s.redirectUntil) : '—'),
          },
          { key: 'since', header: 'Since', cell: (s) => when(s.createdAt) },
        ]}
        rows={p.slugs}
        rowKey={(s) => s.slug}
        stackOnMobile
        empty={<p className="text-sm text-ink-muted">No slug yet.</p>}
      />
      <Table
        caption="Links"
        captionVisible
        columns={[
          { key: 'type', header: 'Type', cell: (l) => <code>{l.linkType}</code> },
          { key: 'label', header: 'Label', cell: (l) => l.label ?? '—' },
          {
            key: 'target',
            header: 'Target',
            cell: (l) => <span className="break-all">{l.url ?? l.phone ?? '—'}</span>,
          },
          { key: 'on', header: 'Shown', cell: (l) => (l.isEnabled ? 'yes' : 'no') },
        ]}
        rows={p.links}
        rowKey={(l) => l.id}
        stackOnMobile
        empty={<p className="text-sm text-ink-muted">No links.</p>}
      />
    </div>
  );
}

export async function AiTab({ db, b }: TabProps) {
  const ai = await loadAiSetup(db, b.id);
  return (
    <div className="stack">
      <Card title="Ai context" titleAs="h2">
        {ai.context ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-ink-muted">Draft language</dt>
            <dd>{ai.context.draftLanguage}</dd>
            <dt className="text-ink-muted">Summary</dt>
            <dd className="whitespace-pre-line">{ai.context.summary || '—'}</dd>
            <dt className="text-ink-muted">Services</dt>
            <dd>{ai.context.services.join(', ') || '—'}</dd>
            <dt className="text-ink-muted">Context terms</dt>
            <dd>{ai.context.contextTerms.join(', ') || '—'}</dd>
            <dt className="text-ink-muted">Updated</dt>
            <dd>{ai.context.updatedAt ? when(ai.context.updatedAt) : '—'}</dd>
          </dl>
        ) : (
          <p className="text-sm text-ink-muted">No context set up yet.</p>
        )}
      </Card>
      <Card title="Prompt version" titleAs="h2">
        <p className="text-sm">
          Active platform-wide: <code>{ai.activePromptVersion ?? '—'}</code>. Last draft for this
          business used <code>{ai.lastPromptVersion ?? '—'}</code>.{' '}
          <Link href="/admin/ai">Ai prompts →</Link>
        </p>
      </Card>
      <Table
        caption="Review modes"
        captionVisible
        columns={[
          { key: 'name', header: 'Mode', cell: (m) => m.name },
          { key: 'desc', header: 'Description', cell: (m) => m.description ?? '—' },
          { key: 'terms', header: 'Terms', cell: (m) => m.contextTerms.join(', ') || '—' },
          {
            key: 'state',
            header: 'State',
            cell: (m) =>
              m.isArchived ? (
                <Badge tone="neutral">archived</Badge>
              ) : m.isActive ? (
                <Badge tone="success">active</Badge>
              ) : (
                'inactive'
              ),
          },
          { key: 'updated', header: 'Updated', cell: (m) => when(m.updatedAt) },
        ]}
        rows={ai.modes}
        rowKey={(m) => m.id}
        stackOnMobile
        empty={<p className="text-sm text-ink-muted">No review modes.</p>}
      />
    </div>
  );
}

export async function QrTab({ db, b }: TabProps) {
  const sources = await loadQrSources(db, b.id);
  return (
    <Table
      caption="QR sources"
      captionVisible
      columns={[
        { key: 'label', header: 'Label', cell: (q) => q.sourceLabel },
        { key: 'code', header: 'Code', cell: (q) => <code>{q.code}</code> },
        {
          key: 'status',
          header: 'Status',
          cell: (q) =>
            q.status === 'ACTIVE' ? (
              <Badge tone="success">active</Badge>
            ) : (
              <Badge tone="neutral">{q.status.toLowerCase()}</Badge>
            ),
        },
        { key: 'scans', header: 'Scans, 30 days', cell: (q) => q.scans30d },
        { key: 'note', header: 'Note', cell: (q) => q.internalNote ?? '—' },
        { key: 'created', header: 'Created', cell: (q) => when(q.createdAt) },
        {
          key: 'open',
          header: 'Link',
          cell: (q) => (
            <a href={`/q/${q.code}`} target="_blank" rel="noopener noreferrer">
              /q/{q.code}
            </a>
          ),
        },
      ]}
      rows={sources}
      rowKey={(q) => q.id}
      stackOnMobile
      empty={<p className="text-sm text-ink-muted">No QR sources.</p>}
    />
  );
}

export async function AnalyticsTab({ db, b }: TabProps) {
  const f = await loadFunnel(db, b.id);
  const max = Math.max(1, ...f.daily.map((d) => d.scans));
  const steps = [
    { label: 'QR scans', value: f.scans },
    { label: 'Page views', value: f.pageViews },
    { label: 'Ai drafts', value: f.drafts },
    { label: 'Copies', value: f.copies },
    { label: 'Google opens', value: f.googleOpens },
  ];
  return (
    <div className="stack">
      <Card
        title="30-day funnel"
        titleAs="h2"
        description="Counts from analytics events; each step as a share of the one before."
      >
        <ol className="grid gap-3 sm:grid-cols-5">
          {steps.map((s, i) => {
            const prev = i === 0 ? null : steps[i - 1]!.value;
            const pct = prev ? Math.round((s.value / prev) * 100) : null;
            return (
              <li key={s.label} className="rounded-card border border-border p-3">
                <p className="text-xs text-ink-muted">{s.label}</p>
                <p className="text-2xl font-semibold tabular-nums">{s.value}</p>
                {pct !== null && <p className="text-xs text-ink-muted">{pct}% of previous</p>}
              </li>
            );
          })}
        </ol>
        <p className="mt-3 text-sm text-ink-muted">
          {f.feedbackSubmits} private feedback submissions in the same window.
        </p>
      </Card>
      <Card title="Daily scans, 30 days" titleAs="h2">
        {f.daily.length === 0 ? (
          <p className="text-sm text-ink-muted">Nothing recorded in the last 30 days.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="text-xs">
              <caption className="sr-only">Daily scans, drafts and Google opens</caption>
              <thead>
                <tr className="text-left text-ink-muted">
                  <th scope="col" className="pr-3 font-medium">
                    Day
                  </th>
                  <th scope="col" className="pr-3 font-medium">
                    Scans
                  </th>
                  <th scope="col" className="pr-3 font-medium">
                    Drafts
                  </th>
                  <th scope="col" className="pr-3 font-medium">
                    Google opens
                  </th>
                  <th scope="col" className="font-medium">
                    Scans, relative
                  </th>
                </tr>
              </thead>
              <tbody>
                {f.daily.map((d) => (
                  <tr key={d.day}>
                    <td className="pr-3 tabular-nums">{d.day}</td>
                    <td className="pr-3 tabular-nums">{d.scans}</td>
                    <td className="pr-3 tabular-nums">{d.drafts}</td>
                    <td className="pr-3 tabular-nums">{d.googleOpens}</td>
                    <td>
                      <span
                        aria-hidden="true"
                        className="inline-block h-2 rounded-sm bg-accent"
                        style={{ width: `${Math.max(2, (d.scans / max) * 160)}px` }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

export function BillingTab({ b, canAct }: TabProps) {
  return (
    <div className="stack">
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
      {canAct && (
        <BusinessActions
          businessId={b.id}
          status={b.status}
          plan={b.plan}
          freeLimit={b.freeLimit}
          freeUsed={b.freeUsed}
        />
      )}
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
                  p.status === 'CAPTURED'
                    ? 'success'
                    : p.status === 'FAILED'
                      ? 'danger'
                      : p.status === 'REFUNDED'
                        ? 'warning'
                        : 'neutral'
                }
              >
                {p.status}
              </Badge>
            ),
          },
          {
            key: 'refunded',
            header: 'Refunded',
            cell: (p) => (p.refundedPaise > 0 ? rupees(p.refundedPaise) : '—'),
          },
          {
            key: 'invoice',
            header: 'Invoice',
            cell: (p) =>
              p.invoiceNumber ? (
                <Link href={`/admin/payments/${p.id}/invoice`} className="font-mono text-xs">
                  {p.invoiceNumber}
                </Link>
              ) : (
                '—'
              ),
          },
          { key: 'ref', header: 'Razorpay payment', cell: (p) => p.providerPaymentId ?? '—' },
        ]}
        rows={b.payments}
        rowKey={(p) => p.id}
        stackOnMobile
        empty={<p className="text-sm text-ink-muted">No payments yet.</p>}
      />
      <p className="text-sm">
        <Link href={`/admin/payments?business=${b.id}`}>Open in Payments →</Link> for refunds,
        reconciliation and the webhook ledger.
      </p>
    </div>
  );
}

export async function DomainTab({ db, b }: TabProps) {
  const rows = await loadDomains(db, b.id);
  return (
    <Table
      caption="Custom domains"
      captionVisible
      columns={[
        { key: 'host', header: 'Hostname', cell: (d) => <code>{d.hostname}</code> },
        {
          key: 'status',
          header: 'Status',
          cell: (d) => (
            <Badge tone={d.status === 'ACTIVE' ? 'success' : 'neutral'}>{d.status}</Badge>
          ),
        },
        { key: 'ssl', header: 'SSL', cell: (d) => d.sslStatus ?? '—' },
        { key: 'dns', header: 'DNS target', cell: (d) => d.dnsTarget ?? '—' },
        {
          key: 'activated',
          header: 'Activated',
          cell: (d) => (d.activatedAt ? when(d.activatedAt) : '—'),
        },
        {
          key: 'checked',
          header: 'Last check',
          cell: (d) => (d.lastCheckedAt ? when(d.lastCheckedAt) : '—'),
        },
        { key: 'error', header: 'Error', cell: (d) => d.errorMessage ?? '—' },
      ]}
      rows={rows}
      rowKey={(d) => d.id}
      stackOnMobile
      empty={
        <p className="text-sm text-ink-muted">
          No custom domain. Custom domains ship in E11; this tab is read-only until then.
        </p>
      }
    />
  );
}

export async function UsageTab({ db, b, canAct }: TabProps) {
  const u = await loadUsage(db, b.id);
  const max = Math.max(1, ...u.daily.map((d) => d.generations));
  const spike = u.last24h >= 20 && u.last24h > 3 * u.avgPerDay7d;
  return (
    <div className="stack">
      <section aria-label="Ai usage" className="grid gap-4 sm:grid-cols-3">
        <KpiCard
          label="Ai drafts, 24 h"
          value={u.last24h}
          hint={spike ? 'Spike: more than 3× the 7-day average' : undefined}
        />
        <KpiCard label="7-day average per day" value={u.avgPerDay7d.toFixed(1)} />
        <KpiCard
          label="Private feedback, 24 h"
          value={u.feedback24h}
          hint={u.feedback24h >= 10 ? 'Unusually high — possible spam' : undefined}
        />
      </section>
      <Card title="Generations per day, 14 days" titleAs="h2">
        {u.daily.length === 0 ? (
          <p className="text-sm text-ink-muted">No drafts in the last 14 days.</p>
        ) : (
          <ul className="text-xs">
            {u.daily.map((d) => (
              <li key={d.day} className="flex items-center gap-2">
                <span className="w-24 tabular-nums">{d.day}</span>
                <span className="w-8 text-right tabular-nums">{d.generations}</span>
                <span
                  aria-hidden="true"
                  className="inline-block h-2 rounded-sm bg-accent"
                  style={{ width: `${Math.max(2, (d.generations / max) * 200)}px` }}
                />
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card
        title="Ai controls"
        titleAs="h2"
        description="Suspending Ai keeps the public page and the Google button working; only drafting stops, with a safe notice to the customer."
      >
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-ink-muted">Ai generation</dt>
          <dd>
            {u.aiSuspendedAt ? (
              <>
                <Badge tone="danger">suspended</Badge> since {when(u.aiSuspendedAt)} —{' '}
                {u.aiSuspendedReason ?? 'no reason recorded'}
              </>
            ) : (
              <Badge tone="success">on</Badge>
            )}
          </dd>
          <dt className="text-ink-muted">Throttle</dt>
          <dd>
            {u.aiThrottleUntil && u.aiThrottleUntil > new Date()
              ? `${u.aiThrottlePerHour} drafts an hour until ${when(u.aiThrottleUntil)}`
              : 'none'}
          </dd>
        </dl>
        {canAct && (
          <div className="mt-4">
            <AbuseActions
              businessId={b.id}
              aiSuspended={u.aiSuspendedAt !== null}
              throttled={u.aiThrottleUntil !== null && u.aiThrottleUntil > new Date()}
              ownerEmail={b.ownerEmail}
            />
          </div>
        )}
      </Card>
    </div>
  );
}

export async function ActivityTab({ b }: TabProps) {
  const activity = await loadActivity({ businessId: b.id, limit: 50 });
  return (
    <section aria-labelledby="activity-heading" className="stack">
      <h2 id="activity-heading" className="flex items-baseline justify-between gap-3">
        Owner activity
        <Link href={`/admin/activity?business=${b.id}`} className="text-sm font-medium text-accent">
          Open in the explorer →
        </Link>
      </h2>
      <ActivityTable rows={activity.rows} showBusiness={false} caption="Owner activity" />
    </section>
  );
}

export function AuditTab({ b }: TabProps) {
  return (
    <Table
      caption="Audit history"
      captionVisible
      columns={[
        { key: 'when', header: 'When', cell: (e) => when(e.createdAt) },
        {
          key: 'who',
          header: 'Who',
          cell: (e) => (e.actorType === 'SYSTEM' ? 'system' : (e.actorEmail ?? 'unknown')),
        },
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

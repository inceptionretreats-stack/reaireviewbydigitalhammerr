import type { Metadata } from 'next';
import Link from 'next/link';
import { Card, KpiCard } from '@ai-review/ui';
import { db } from '@/lib/db';
import { loadOverview } from '@/lib/admin/businesses';

export const metadata: Metadata = { title: 'Platform overview | Ai Review admin' };
export const dynamic = 'force-dynamic';

/**
 * ADMIN-01. The numbers the spec lists, from the tables that hold them. "Revenue" is shown as
 * the annual value of currently paid businesses — the spec is explicit that it must not be
 * called ARR unless it is accounting-correct, and a sum of list prices is not.
 */
export default async function AdminOverviewPage() {
  const o = await loadOverview(db());
  const rupees = (paise: number) => `₹${Math.round(paise / 100).toLocaleString('en-IN')}`;

  return (
    <div className="stack">
      <header>
        <p className="text-sm text-ink-muted">Admin</p>
        <h1>Platform overview</h1>
      </header>

      <section aria-label="Businesses" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Businesses"
          value={o.businesses.total}
          hint={`${o.businesses.active} active`}
        />
        <KpiCard label="On Pro" value={o.businesses.pro} hint={`${o.businesses.free} on Free`} />
        <KpiCard
          label="Paid value, current periods"
          value={rupees(o.paidValuePaise)}
          hint="List price of active paid years — not accounting revenue"
        />
        <KpiCard label="Suspended" value={o.businesses.suspended} />
      </section>

      <section aria-label="Activity" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Signups"
          value={o.signups.last30d}
          hint={`${o.signups.today} today · ${o.signups.last7d} this week`}
        />
        <KpiCard
          label="Ai drafts, 30 days"
          value={o.drafts.last30d}
          hint={`${o.drafts.today} today`}
        />
        <KpiCard
          label="QR scans, 30 days"
          value={o.scans.last30d}
          hint={`${o.googleOpens.last30d} Google opens`}
        />
        <KpiCard label="Payment failures, 30 days" value={o.paymentFailures30d} />
      </section>

      <Card title="Where to go" titleAs="h2">
        <ul className="stack text-sm">
          <li>
            <Link href="/admin/businesses">Businesses</Link> — search any tenant; activate or extend
            Pro, adjust the free allowance, suspend, reactivate. Each with a reason.
          </li>
          <li>
            <Link href="/admin/ai">Ai prompts</Link> — the prompt versions every business writes
            with; edit the rules, activate, roll back. No deploy.
          </li>
          <li>
            <Link href="/admin/settings">Platform settings</Link> — the free allowance and the Pro
            price, versioned.
          </li>
          <li>
            <Link href="/admin/audit">Audit log</Link> — who changed what, when, and why.
          </li>
        </ul>
      </Card>
    </div>
  );
}

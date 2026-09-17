import type { Metadata } from 'next';
import Link from 'next/link';
import { Card, KpiCard } from '@ai-review/ui';
import { paymentOverview } from '@ai-review/core';
import { db } from '@/lib/db';
import { loadOverview } from '@/lib/admin/businesses';
import { loadAbuseAlerts } from '@/lib/admin/abuse-alerts';

export const metadata: Metadata = { title: 'Platform overview | Ai Review admin' };
export const dynamic = 'force-dynamic';

/**
 * ADMIN-01. The numbers the spec lists, from the tables that hold them. "Revenue" is shown as
 * the annual value of currently paid businesses — the spec is explicit that it must not be
 * called ARR unless it is accounting-correct, and a sum of list prices is not.
 */
export default async function AdminOverviewPage() {
  const database = db();
  const [o, pay, alerts] = await Promise.all([
    loadOverview(database),
    paymentOverview(database, new Date(Date.now() - 30 * 86_400_000)),
    loadAbuseAlerts(database),
  ]);
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

      {/* AMENDMENT-029 — money, and what still needs a hand. */}
      <section aria-label="Payments" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Collected, 30 days"
          value={rupees(pay.capturedPaise)}
          hint="Captured payments, before refunds"
        />
        <KpiCard
          label="Open payments"
          value={pay.open}
          hint="Started in the last 30 days, not yet paid or failed"
        />
        <KpiCard label="Refunds, 30 days" value={pay.refunded} />
        <Card title="Payments" titleAs="h2">
          <p className="text-sm text-ink-muted">
            <Link href="/admin/payments">All payments</Link> — refunds, reconciliation, the webhook
            ledger. <Link href="/admin/payments?status=CREATED">Open ones</Link> may need a check
            against Razorpay.
          </p>
        </Card>
      </section>

      {/* AMENDMENT-030 — computed on read; an empty list is the normal state. */}
      <Card
        title={`Abuse alerts${alerts.length ? ` (${alerts.length})` : ''}`}
        titleAs="h2"
        description="Generation spikes, feedback spam, repeated sign-ups from one address, and Ai contexts that ask for what the output gate refuses."
      >
        {alerts.length === 0 ? (
          <p className="text-sm text-ink-muted">
            Nothing tripped. Signals are re-evaluated on every load.
          </p>
        ) : (
          <ul className="stack text-sm">
            {alerts.slice(0, 5).map((a, i) => (
              <li key={i}>
                {a.businessId ? (
                  <Link
                    href={`/admin/businesses/${a.businessId}?tab=usage`}
                    className="font-semibold"
                  >
                    {a.businessName}
                  </Link>
                ) : (
                  <span className="font-semibold">Sign-ups</span>
                )}{' '}
                — {a.signal.summary}
              </li>
            ))}
            {alerts.length > 5 && (
              <li className="text-ink-muted">
                {alerts.length - 5} more —{' '}
                <Link href="/admin/businesses?high_ai=true">see high Ai usage</Link>.
              </li>
            )}
          </ul>
        )}
      </Card>

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
            <Link href="/admin/payments">Payments</Link> — every payment and invoice, refunds with a
            reason, and what Razorpay delivered.
          </li>
          <li>
            <Link href="/admin/activity">Activity</Link> — what owners and admins did, sign-ins
            included.
          </li>
          <li>
            <Link href="/admin/team">Team</Link> — invite an admin or a support viewer, reset MFA,
            disable an account.
          </li>
          <li>
            <Link href="/admin/audit">Audit log</Link> — who changed what, when, and why.
          </li>
        </ul>
      </Card>
    </div>
  );
}

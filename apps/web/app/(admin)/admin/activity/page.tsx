import type { Metadata } from 'next';
import Link from 'next/link';
import { adminActivityQuery } from '@ai-review/contracts';
import { ACTIVITY_ACTIONS } from '@ai-review/core';
import { Card } from '@ai-review/ui';
import { ActivityFilters } from '@/components/admin/ActivityFilters';
import { ActivityTable } from '@/components/admin/ActivityTable';
import { activityFilterFrom, loadActivity, resolveUserIdByEmail } from '@/lib/admin/activity';

export const metadata: Metadata = { title: 'Activity | Ai Review admin' };
export const dynamic = 'force-dynamic';

/**
 * AMENDMENT-028 — every action a signed-in person took, newest first, filterable. A plain GET
 * form: the URL is the filter, so a view can be bookmarked or pasted to a colleague.
 */
export default async function AdminActivityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (key: string) => {
    const v = params[key];
    const s = Array.isArray(v) ? v[0] : v;
    return s && s.trim() ? s.trim() : undefined;
  };
  const email = one('email');
  const userId = email ? await resolveUserIdByEmail(email) : undefined;
  const parsed = adminActivityQuery.safeParse({
    user: userId ?? undefined,
    business: one('business'),
    action: one('action'),
    outcome: one('outcome'),
    from: one('from'),
    to: one('to'),
    before: one('before'),
  });
  const query = parsed.success ? parsed.data : {};
  const { rows, nextBefore } =
    email && userId === null
      ? { rows: [], nextBefore: null }
      : await loadActivity(await activityFilterFrom(query));

  const areas = [...new Set(ACTIVITY_ACTIONS.map((a) => `${a.split('.')[0]}.`))];
  const older = new URLSearchParams(
    Object.entries(params).flatMap(([k, v]) =>
      typeof v === 'string' && k !== 'before' ? [[k, v]] : [],
    ),
  );
  if (nextBefore) older.set('before', String(nextBefore));

  return (
    <div className="stack">
      <div>
        <p className="text-xs font-semibold tracking-wider text-ink-muted uppercase">
          Platform admin
        </p>
        <h1 className="text-2xl font-bold tracking-tight text-ink">Activity</h1>
        <p className="text-sm text-ink-muted">
          What signed-in owners and admins did — sign-ins, edits, downloads, payments. Kept for 180
          days. Addresses are stored only as hashes.
        </p>
      </div>

      <Card title="Filter" titleAs="h2">
        <ActivityFilters
          values={{
            email: email ?? '',
            business: one('business') ?? '',
            action: one('action') ?? '',
            outcome: one('outcome') ?? '',
            from: one('from') ?? '',
            to: one('to') ?? '',
          }}
          actionOptions={[
            ...areas.map((a) => ({ value: a, label: `${a}* (all ${a.slice(0, -1)})` })),
            ...ACTIVITY_ACTIONS.map((a) => ({ value: a, label: a })),
          ]}
          emailHint={email && userId === null ? 'No account with that email.' : undefined}
        />
      </Card>

      <Card title="Entries" titleAs="h2">
        <ActivityTable rows={rows} />
        {nextBefore && (
          <p className="mt-3">
            <Link
              href={`/admin/activity?${older.toString()}`}
              className="text-sm font-medium text-accent"
            >
              Older →
            </Link>
          </p>
        )}
      </Card>
    </div>
  );
}

import type { Metadata } from 'next';
import { getSession } from '@/lib/auth/session';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { desc } from 'drizzle-orm';
import { aiPromptVersions } from '@ai-review/db';
import { Badge, Table } from '@ai-review/ui';
import { db } from '@/lib/infra/db';
import { adminDateTime } from '@/lib/admin/format';

export const metadata: Metadata = { title: 'Ai prompts | Ai Review admin' };
export const dynamic = 'force-dynamic';

/** ADMIN-03. The table is the spec's column list; each version opens in its editor. */
export default async function AdminAiPage() {
  // 05_RBAC: a support viewer may not see the system prompt or change platform settings.
  const viewerCheck = await getSession();
  if (viewerCheck?.role !== 'SUPER_ADMIN') redirect('/admin');

  const versions = await db()
    .select()
    .from(aiPromptVersions)
    .orderBy(desc(aiPromptVersions.createdAt));

  return (
    <div className="stack">
      <header>
        <p className="text-sm text-ink-muted">Admin</p>
        <h1>Ai prompt versions</h1>
        <p className="text-ink-muted">
          Every draft on the platform is written with the ACTIVE version. Exactly one is active. To
          change the rules: open the active version, start a new draft from it, edit, activate.
          Rolling back is activating the previous one.
        </p>
      </header>
      <Table
        caption="Prompt versions"
        columns={[
          {
            key: 'version',
            header: 'Version',
            cell: (v) => (
              <Link href={`/admin/ai/${v.id}`}>
                <code>{v.version}</code>
              </Link>
            ),
          },
          {
            key: 'status',
            header: 'Status',
            cell: (v) => (
              <Badge
                tone={
                  v.status === 'ACTIVE' ? 'success' : v.status === 'DRAFT' ? 'warning' : 'neutral'
                }
              >
                {v.status}
              </Badge>
            ),
          },
          { key: 'model', header: 'Model', cell: (v) => v.model },
          { key: 'effort', header: 'Reasoning', cell: (v) => v.reasoningEffort || '—' },
          { key: 'max', header: 'Max output', cell: (v) => v.maxOutputTokens },
          { key: 'rollout', header: 'Rollout', cell: (v) => `${v.rolloutPercent}%` },
          {
            key: 'activated',
            header: 'Activated',
            cell: (v) => adminDateTime(v.activatedAt),
          },
        ]}
        rows={versions}
        rowKey={(v) => v.id}
        stackOnMobile
      />
    </div>
  );
}

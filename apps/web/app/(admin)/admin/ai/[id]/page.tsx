import type { Metadata } from 'next';
import { getSession } from '@/lib/session';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Badge } from '@ai-review/ui';
import { PromptVersionService } from '@ai-review/core';
import { db } from '@/lib/db';
import { toWire } from '@/lib/admin/prompt-versions';
import { PromptVersionEditor } from '@/components/admin/PromptVersionEditor';

export const metadata: Metadata = { title: 'Prompt version | Ai Review admin' };
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ADMIN-03 editor page. */
export default async function AdminPromptVersionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // 05_RBAC: a support viewer may not see the system prompt or change platform settings.
  const viewerCheck = await getSession();
  if (viewerCheck?.role !== 'SUPER_ADMIN') redirect('/admin');

  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const row = await new PromptVersionService(db()).get(id);
  if (!row) notFound();
  const wire = toWire(row);

  return (
    <div className="stack">
      <header>
        <p className="text-sm text-ink-muted">
          <Link href="/admin/ai">Ai prompts</Link> / {wire.version}
        </p>
        <h1 className="flex flex-wrap items-center gap-3">
          Prompt version {wire.version}
          <Badge
            tone={
              wire.status === 'ACTIVE' ? 'success' : wire.status === 'DRAFT' ? 'warning' : 'neutral'
            }
          >
            {wire.status}
          </Badge>
        </h1>
      </header>
      <PromptVersionEditor
        version={{
          id: wire.id,
          version: wire.version,
          status: wire.status,
          model: wire.model,
          reasoning_effort: wire.reasoning_effort,
          max_output_tokens: wire.max_output_tokens,
          system_prompt: wire.system_prompt,
          guidance: wire.guidance,
        }}
      />
    </div>
  );
}

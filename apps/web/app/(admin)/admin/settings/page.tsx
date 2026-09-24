import type { Metadata } from 'next';
import { getSession } from '@/lib/auth/session';
import { redirect } from 'next/navigation';
import { PlatformSettingsService } from '@ai-review/core';
import { db } from '@/lib/infra/db';
import { PlatformSettingsForm } from '@/components/admin/PlatformSettingsForm';

export const metadata: Metadata = { title: 'Platform settings | Ai Review admin' };
export const dynamic = 'force-dynamic';

/** ADMIN-04. */
export default async function AdminSettingsPage() {
  // 05_RBAC: a support viewer may not see the system prompt or change platform settings.
  const viewerCheck = await getSession();
  if (viewerCheck?.role !== 'SUPER_ADMIN') redirect('/admin');

  const settings = await new PlatformSettingsService(db()).readAll();
  return (
    <div className="stack">
      <header>
        <p className="text-sm text-ink-muted">Admin</p>
        <h1>Platform settings</h1>
        <p className="text-ink-muted">
          The numbers the product sells with. They were environment variables; now they are data
          with a version and an audit trail.
        </p>
      </header>
      <PlatformSettingsForm
        settings={settings.map((s) => ({
          key: s.key,
          value: s.value,
          version: s.version,
          updatedAt: s.updatedAt ? s.updatedAt.toISOString() : null,
        }))}
      />
    </div>
  );
}

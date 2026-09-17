import type { Metadata } from 'next';
import { AcceptInviteForm } from '@/components/auth/AcceptInviteForm';

export const metadata: Metadata = { title: 'Join the admin team | Ai Review' };
export const dynamic = 'force-dynamic';

/** AMENDMENT-027 — the invitation link lands here with its token in the query string. */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = (await searchParams)['token'];
  const token = Array.isArray(raw) ? raw[0] : raw;
  if (!token) {
    return (
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold tracking-tight text-ink">That link is incomplete</h1>
        <p className="text-sm text-ink-muted">
          Open the invitation from the email you received, or ask the admin who invited you to send
          it again.
        </p>
      </div>
    );
  }
  return <AcceptInviteForm token={token} />;
}

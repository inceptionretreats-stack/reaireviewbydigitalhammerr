import type { Metadata } from 'next';
import { ResetPasswordForm } from '@/components/auth/ResetPasswordForm';

export const metadata: Metadata = {
  title: 'Choose a new password | Ai Review',
  description: 'Set a new password using the link from your email.',
  // The URL carries a live single-use credential, so it must never be indexed or referred out.
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

/**
 * The token arrives as a query parameter, which an emailed link leaves no alternative to. It is
 * read on the server and handed to the client component as a prop rather than being read from
 * the URL in the browser, so it is never in a client-side router cache entry.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = params.token;
  const token = Array.isArray(raw) ? raw[0] : raw;

  return <ResetPasswordForm token={token} />;
}

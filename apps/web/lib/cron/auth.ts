import { timingSafeEqual } from 'node:crypto';

/** Bearer check for Vercel Cron: `Authorization: Bearer <CRON_SECRET>`, compared in constant time. */
export function cronAuthorised(
  header: string | null,
  secret: string | undefined,
): 'ok' | 'unset' | 'wrong' {
  if (!secret) return 'unset';
  if (!header || !/^Bearer\s+/i.test(header)) return 'wrong';
  const given = header?.replace(/^Bearer\s+/i, '').trim() ?? '';
  const a = Buffer.from(given, 'utf8');
  const b = Buffer.from(secret, 'utf8');
  if (a.length !== b.length || a.length === 0) return 'wrong';
  return timingSafeEqual(a, b) ? 'ok' : 'wrong';
}

import { env } from '@/lib/env';

/**
 * Dates on the admin screens, in the platform's own timezone.
 *
 * `toLocaleString` without a `timeZone` renders in the server's clock, which on this laptop was
 * IST and on Vercel is UTC — the first live admin page showed a business "joined 9:09 am" that
 * had signed up at 14:39. The owner screens already format in the business timezone (AC-026);
 * the admin is one person in India, so the platform default (`DEFAULT_TIMEZONE`) is the right
 * clock here, and it is the same on every host.
 */
export function adminDateTime(value: Date | null | undefined): string {
  if (!value) return '—';
  return value.toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: env().DEFAULT_TIMEZONE,
  });
}

export function adminDate(value: Date | null | undefined): string {
  if (!value) return '—';
  return value.toLocaleDateString('en-IN', {
    dateStyle: 'medium',
    timeZone: env().DEFAULT_TIMEZONE,
  });
}

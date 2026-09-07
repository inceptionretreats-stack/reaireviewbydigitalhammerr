import type { BadgeTone } from '@ai-review/ui';
import type { RequestRowView } from './types';

/**
 * How REQ-01 describes a prepared request, in words the platform is allowed to use.
 *
 * The wording here is the whole compliance surface of this screen, so it lives in one tested module
 * rather than being written inline three times:
 *
 *  - "Marked sent by you" and never "Sent". AC-023 requires the sent status to read as a manual
 *    business action, and the platform did not send anything (D-017, ADR-004, REQ-01-02).
 *  - "Link opened" and never anything about a review existing. Opening the link is the last event
 *    this product can observe (D-028, AC-025, DASH-01-02); what happens on Google is Google's.
 *  - Every badge pairs a word with a tone, and `Badge` adds a glyph, so none of it is carried by
 *    colour alone (18_UI_UX_Design_System_Brief.md, AC-038).
 */

export interface RequestBadge {
  tone: BadgeTone;
  label: string;
}

/**
 * The badges for one row, in reading order.
 *
 * Always at least one, so a row is never a blank status cell. The two facts are independent: an owner
 * can forget to mark a message they did send, and a customer can open a link the owner never marked.
 */
export function describeRequest(
  row: Pick<RequestRowView, 'markedSentAtLabel' | 'firstClickedAtLabel'>,
): RequestBadge[] {
  const badges: RequestBadge[] = [
    row.markedSentAtLabel === null
      ? { tone: 'neutral', label: 'Prepared' }
      : { tone: 'success', label: 'Marked sent by you' },
  ];

  if (row.firstClickedAtLabel !== null) {
    badges.push({ tone: 'accent', label: 'Link opened' });
  }

  return badges;
}

/**
 * A date and time in the business's own timezone (AMENDMENT-004, AC-026).
 *
 * Both parts, unlike the dashboard's date-only formatter: an owner preparing several messages in one
 * sitting needs to tell them apart, and "7 Sept 2026" three times over does not.
 */
export function formatDateTime(iso: string, timezone: string): string {
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return '';

  try {
    return new Intl.DateTimeFormat('en-IN', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: timezone,
    }).format(value);
  } catch {
    // businesses.timezone is free text, so an unrecognised IANA name is reachable and must not take
    // the screen down. UTC is the documented default AC-026 allows.
    return new Intl.DateTimeFormat('en-IN', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'UTC',
    }).format(value);
  }
}

/** `formatDateTime` for a value that may be absent, keeping the null through to the view model. */
export function formatOptionalDateTime(
  value: Date | string | null,
  timezone: string,
): string | null {
  if (value === null) return null;
  const iso = value instanceof Date ? value.toISOString() : value;
  return formatDateTime(iso, timezone);
}

/**
 * The customer selector's option label.
 *
 * The mobile number is part of it because two customers called "Anil" is the normal case in a walk-in
 * contact list, and picking the wrong one means a stranger gets a message about a visit they did not
 * make. It is the owner's own contact data shown back to them, so nothing is masked.
 */
export function customerOptionLabel(name: string, mobile: string): string {
  return mobile.trim() === '' ? name : `${name} — ${mobile}`;
}

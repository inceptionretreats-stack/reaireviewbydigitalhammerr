import type { BadgeTone, SelectOption } from '@ai-review/ui';
import {
  CUSTOMER_STATUS_ORDER,
  OWNER_SETTABLE_STATUSES,
  statusAuthority,
  type CustomerStatus,
} from '@/lib/crm/customers/customer-status';

/**
 * How CRM-01 words and colours a contact.
 *
 * The status vocabulary is the compliance-sensitive part of this screen. GOOGLE_OPENED means one
 * thing only — the customer opened Google — because a review is written on Google's own page, where
 * the platform cannot see it. D-028, AC-025 and rule 8 of `13_Security_Privacy_Compliance.md` all
 * say so. Every label and explanation below is therefore about what was *observed*, never about what
 * was achieved. A lint rule catches the worst phrasing at build time; this table is where the honest
 * phrasing actually lives.
 *
 * The authority classes come from `customer-status.ts`, which the endpoint enforces, so this screen
 * cannot offer a control the API would refuse — or hide one it would accept.
 */

export interface StatusPresentation {
  label: string;
  tone: BadgeTone;
  /** One sentence on what the state means, shown where the owner reads or chooses it. */
  detail: string;
}

/**
 * `Record<CustomerStatus, …>` so a ninth value in `customer_request_status` is a compile error here
 * rather than a badge with no words in it.
 */
const STATUS: Record<CustomerStatus, StatusPresentation> = {
  NOT_CONTACTED: {
    label: 'Not asked yet',
    tone: 'neutral',
    detail: 'You have not prepared a review request for them yet.',
  },
  MESSAGE_PREPARED: {
    label: 'Message ready',
    tone: 'accent',
    detail: 'You prepared a message for them but have not marked it as sent.',
  },
  MESSAGE_SENT_MANUAL: {
    label: 'Sent by you',
    tone: 'accent',
    // D-017 / ADR-004: the platform never sends anything, so this can only ever be the owner's own
    // record of something it did not witness. Saying so is the point.
    detail: 'You told us you sent the message yourself. We never send it for you.',
  },
  LINK_CLICKED: {
    label: 'Opened your link',
    tone: 'accent',
    detail: 'They opened the review link you sent them.',
  },
  AI_GENERATED: {
    label: 'Draft written',
    tone: 'accent',
    detail: 'They asked for a draft review on your page.',
  },
  REVIEW_COPIED: {
    label: 'Text copied',
    tone: 'accent',
    detail: 'They copied the review text from your page.',
  },
  GOOGLE_OPENED: {
    label: 'Google opened',
    tone: 'success',
    // The single most important sentence on this screen.
    detail: 'They opened your Google review page. We cannot see what happens on Google.',
  },
  PRIVATE_FEEDBACK: {
    label: 'Private feedback',
    tone: 'accent',
    detail: 'They sent you private feedback instead. It is on the Private Feedback screen.',
  },
};

export function describeStatus(status: CustomerStatus): StatusPresentation {
  return STATUS[status];
}

/**
 * Who owns the value, in a sentence — the difference between a field the owner may change and a
 * record they may only read.
 */
export function describeStatusAuthority(status: CustomerStatus): string {
  switch (statusAuthority(status)) {
    case 'OWNER_SETTABLE':
      return 'You can change this.';
    case 'OWNER_ACTION':
      return 'This was set when you prepared a message. To change it, mark the message as sent.';
    case 'OBSERVED':
      return 'This records what happened on your review page, so it cannot be changed by hand.';
  }
}

/** The only two values a dropdown may offer. Derived, so it cannot disagree with the endpoint. */
export const OWNER_STATUS_OPTIONS: readonly SelectOption[] = OWNER_SETTABLE_STATUSES.map(
  (status) => ({ value: status, label: STATUS[status].label }),
);

export interface StatusLegendEntry {
  status: CustomerStatus;
  presentation: StatusPresentation;
}

/** Every status in progression order, for the screen's "how statuses work" note. */
export const STATUS_LEGEND: readonly StatusLegendEntry[] = CUSTOMER_STATUS_ORDER.map((status) => ({
  status,
  presentation: STATUS[status],
}));

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/**
 * A `YYYY-MM-DD` visit date as `7 Sep 2026`.
 *
 * Deliberately not `Intl.DateTimeFormat`, for two reasons that both come from this screen rendering
 * the same rows on the server and then again in the browser. Intl's output depends on the ICU build,
 * so Node and a browser can disagree over "Sep" against "Sept" and React then replaces the server
 * HTML on hydration. And `visit_date` is a bare calendar date with no timezone: handing it to a date
 * formatter means inventing an instant, which makes "they came in on the 7th" read as the 6th to
 * anyone whose clock is behind the shop's. Splitting the string has neither problem.
 */
export function formatVisitDate(value: string | null): string | null {
  if (value === null) return null;

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const [, year, month, day] = match;
  if (year === undefined || month === undefined || day === undefined) return null;

  const monthName = MONTHS[Number(month) - 1];
  if (monthName === undefined) return null;

  return `${Number(day)} ${monthName} ${year}`;
}

/**
 * An E.164 mobile grouped for reading: `+919876543210` becomes `+91 98765 43210`.
 *
 * Only Indian numbers are grouped, because a 10-digit national number is the only shape this product
 * is sure of (D-002 — and `normalizePhone` shape-validates no other country). Anything else is shown
 * exactly as stored rather than split on a guess about its national format.
 */
export function formatMobile(e164: string): string {
  const match = /^\+91(\d{5})(\d{5})$/.exec(e164);
  if (!match) return e164;

  const [, first, second] = match;
  if (first === undefined || second === undefined) return e164;

  return `+91 ${first} ${second}`;
}

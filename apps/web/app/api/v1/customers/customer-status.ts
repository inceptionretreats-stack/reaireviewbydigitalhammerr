import type { Customer } from '@ai-review/db';

/**
 * Who is allowed to write each value of `customer_request_status` (CRM-01, D-018).
 *
 * `03_Screen_Field_Button_Spec.md` lists "Manual status" as a CRM-01 field, which reads as though
 * the whole enum were a dropdown. It cannot be. Five of the eight values are the platform's record
 * of what a *customer* did on the review page — and one of them, GOOGLE_OPENED, is the single
 * observation D-028 and AC-025 are careful about: the product may say Google was opened and nothing
 * more. A control that let an owner select it by hand would turn a measurement into a claim, which
 * is precisely what "never invent data" forbids.
 *
 * So the enum is split three ways rather than two:
 *
 * - `OWNER_SETTABLE` — the owner's own record of their own action, and the only values a request
 *   body may carry. NOT_CONTACTED is the reset ("I have not got round to it"), and
 *   MESSAGE_SENT_MANUAL is the one fact only the owner can know, because D-017 / ADR-004 mean the
 *   platform never sends the message and therefore never sees it leave.
 * - `OWNER_ACTION` — written by another owner-driven endpoint rather than chosen from a list.
 *   MESSAGE_PREPARED belongs to REQ-01 creating a review request. Not selectable here (the owner
 *   prepares a message by preparing one, not by relabelling a row), but not history either, so it
 *   does not lock the field.
 * - `OBSERVED` — the platform watched the customer progress through Flow F. Read-only history: once
 *   a row reaches one of these, its status stops being editable at all. Otherwise an owner could
 *   overwrite an observation, and the funnel would report whatever they last clicked.
 *
 * Where the value comes from, per `11_Analytics_Event_Taxonomy.csv`, is what decides the class —
 * not how far along the sequence it happens to sit.
 */

export type CustomerStatus = Customer['status'];

export type StatusAuthority = 'OWNER_SETTABLE' | 'OWNER_ACTION' | 'OBSERVED';

/**
 * Exhaustive by construction: `Record<CustomerStatus, …>` means adding a ninth value to
 * `customer_request_status` is a compile error here rather than a status that silently becomes
 * owner-editable, or one the UI cannot label.
 */
const AUTHORITY: Record<CustomerStatus, StatusAuthority> = {
  NOT_CONTACTED: 'OWNER_SETTABLE',
  MESSAGE_PREPARED: 'OWNER_ACTION',
  MESSAGE_SENT_MANUAL: 'OWNER_SETTABLE',
  LINK_CLICKED: 'OBSERVED',
  AI_GENERATED: 'OBSERVED',
  REVIEW_COPIED: 'OBSERVED',
  GOOGLE_OPENED: 'OBSERVED',
  PRIVATE_FEEDBACK: 'OBSERVED',
};

/**
 * The values a request body may carry, in the order a form should offer them.
 *
 * Declared as a tuple rather than derived by filtering AUTHORITY, because a filtered
 * `Object.entries` gives back `string[]` and loses the literal union that makes a parsed value
 * assignable to the column. A test cross-checks the tuple against the table above, so the two
 * cannot drift.
 */
export const OWNER_SETTABLE_STATUSES = [
  'NOT_CONTACTED',
  'MESSAGE_SENT_MANUAL',
] as const satisfies readonly CustomerStatus[];

export type OwnerSettableStatus = (typeof OWNER_SETTABLE_STATUSES)[number];

/**
 * Narrows a value straight out of a request body.
 *
 * The gate is the *tuple*, not the enum: a body naming GOOGLE_OPENED is rejected here rather than
 * accepted as a valid enum member and refused later, so there is one place where "what a client may
 * send" is decided. `zod` is deliberately not used — it is not a declared dependency of `apps/web`,
 * and the shared DTOs in `@ai-review/contracts` are the only place the app should need it.
 */
export function isOwnerSettableStatusValue(value: unknown): value is OwnerSettableStatus {
  return (
    typeof value === 'string' && (OWNER_SETTABLE_STATUSES as readonly string[]).includes(value)
  );
}

export function statusAuthority(status: CustomerStatus): StatusAuthority {
  return AUTHORITY[status];
}

/**
 * True once the platform has observed the customer, which makes the status read-only history.
 *
 * Both handlers and the screen ask this one question, so "which statuses lock the field" has a
 * single answer rather than an `includes` list copied into a form and an endpoint.
 */
export function isObservedStatus(status: CustomerStatus): boolean {
  return AUTHORITY[status] === 'OBSERVED';
}

export function isOwnerSettableStatus(status: CustomerStatus): boolean {
  return AUTHORITY[status] === 'OWNER_SETTABLE';
}

/**
 * Narrows an arbitrary string — a value read back from the database in a context where the driver
 * types it loosely, or one arriving from an API response on the client — to the enum.
 *
 * `Object.hasOwn` rather than an array `includes`, so it cannot be fooled by 'toString'.
 */
export function isCustomerStatus(value: unknown): value is CustomerStatus {
  return typeof value === 'string' && Object.hasOwn(AUTHORITY, value);
}

/**
 * Every value, in the order a customer passes through them (Flow F).
 *
 * Written out rather than taken from `Object.keys(AUTHORITY)`: key order would only be the
 * progression by coincidence of how the table above happens to be typed, and the sequence is what
 * the screen uses to explain a status, so it should be stated. A test asserts the two agree.
 */
export const CUSTOMER_STATUS_ORDER = [
  'NOT_CONTACTED',
  'MESSAGE_PREPARED',
  'MESSAGE_SENT_MANUAL',
  'LINK_CLICKED',
  'AI_GENERATED',
  'REVIEW_COPIED',
  'GOOGLE_OPENED',
  'PRIVATE_FEEDBACK',
] as const satisfies readonly CustomerStatus[];

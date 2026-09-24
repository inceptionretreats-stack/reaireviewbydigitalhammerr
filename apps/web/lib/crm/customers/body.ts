import { customerRequest } from '@ai-review/contracts';
import { normalizePhone } from '@ai-review/core';
import { isOwnerSettableStatusValue, type OwnerSettableStatus } from './customer-status';
import { describePhoneRejection } from './list-params';
import type { CustomerWriteValues } from './repository';

/**
 * One request body to one set of stored values, for both POST and PATCH.
 *
 * Shared because the two handlers accept the same contact — `customerRequest` from
 * `@ai-review/contracts` is authoritative for every field constraint — and differ only in whether a
 * status may accompany it. Two copies of "trim, validate, normalise the phone" is two chances for the
 * add form and the edit form to disagree about what a valid contact is.
 *
 * Returns a message and the fields it belongs to rather than a `NextResponse`, so the handler stays
 * the only place that decides an HTTP status and this stays readable without one.
 */

/**
 * `customerRequest.email` is `z.email()` with no maximum and `customers.email` is unbounded citext,
 * so nothing else stops a megabyte of "email" being stored. 254 is the longest address SMTP can
 * carry (RFC 5321), which makes anything longer undeliverable by definition. Enforced here and
 * a gap the shared contract should also close.
 */
export const EMAIL_MAX_LENGTH = 254;

/** Mirrors `customerRequest`. Only used for the copy below; the contract does the validating. */
const NAME_MAX_LENGTH = 120;
const NOTE_MAX_LENGTH = 1000;

export interface ParsedCustomerBody {
  values: CustomerWriteValues;
  /** Absent means "leave the status alone", which is what a body without one has to mean. */
  status?: OwnerSettableStatus;
}

export type ReadBodyResult =
  | { ok: true; body: ParsedCustomerBody }
  | { ok: false; message: string; fields: readonly string[] };

export function readCustomerBody(raw: unknown, mode: 'create' | 'update'): ReadBodyResult {
  const shaped = shapeBody(raw);
  if (shaped === null) {
    return { ok: false, message: 'Malformed request body.', fields: [] };
  }

  const parsed = customerRequest.safeParse(shaped);
  if (!parsed.success) {
    const fields = [
      ...new Set(parsed.error.issues.map((issue) => String(issue.path[0] ?? 'body'))),
    ];
    return { ok: false, message: describeFields(fields), fields };
  }

  const email = parsed.data.email;
  if (email !== undefined && email.length > EMAIL_MAX_LENGTH) {
    // Its own message rather than the generic one for this field: the address is well formed, it is
    // simply longer than anything that could be delivered to.
    return {
      ok: false,
      message: `Use ${EMAIL_MAX_LENGTH} characters or fewer for the email address.`,
      fields: ['email'],
    };
  }

  // CRM-01-03: the stored value is always E.164, whatever the owner typed. Done on the server
  // because `normalizePhone` is the one implementation (D-002 makes a bare 10-digit number +91),
  // and because a client-side normalisation would only be a guess the server had to redo.
  const phone = normalizePhone(parsed.data.mobile);
  if (!phone.ok) {
    return { ok: false, message: describePhoneRejection(phone.reason), fields: ['mobile'] };
  }

  const status = readStatus(shaped, mode);
  if (!status.ok) return status;

  return {
    ok: true,
    body: {
      values: {
        name: parsed.data.name,
        mobile: phone.e164,
        // `undefined` from the contract becomes SQL NULL. An empty box means "no email", and a
        // stored '' would then have to be told apart from a missing one at every read.
        email: parsed.data.email ?? null,
        visitDate: parsed.data.visit_date ?? null,
        note: parsed.data.note ?? null,
      },
      ...(status.status === undefined ? {} : { status: status.status }),
    },
  };
}

type StatusResult =
  | { ok: true; status?: OwnerSettableStatus }
  | { ok: false; message: string; fields: readonly string[] };

/**
 * The status a body may set, if any.
 *
 * POST accepts none at all: a contact that has just been written down has not been contacted, and
 * letting the first write name a stage would let it claim something the platform never saw. PATCH
 * accepts only the values `customer-status.ts` classes as owner-settable — the rest are the
 * platform's record of what the customer did, and GOOGLE_OPENED in particular is the one observation
 * D-028 and AC-025 exist to keep honest.
 */
function readStatus(shaped: Record<string, unknown>, mode: 'create' | 'update'): StatusResult {
  const raw = shaped.status;
  if (raw === undefined || raw === null) return { ok: true };

  if (mode === 'create' || !isOwnerSettableStatusValue(raw)) {
    return { ok: false, message: describeFields(['status']), fields: ['status'] };
  }

  return { ok: true, status: raw };
}

/**
 * Normalises the body before the contract sees it.
 *
 * Trimming here rather than in the form is deliberate: the API is the contract, and a name of
 * `'  '` has to fail `min(1)` rather than be stored as two spaces. Blank optional fields collapse to
 * `undefined` so that clearing the email box in the edit form means "remove it" — which is what a
 * full-record update has to mean — instead of storing an empty string.
 *
 * Non-string values are passed through untouched so that the contract reports the type error, rather
 * than this function turning `{ name: 42 }` into something that reads as a missing field.
 */
function shapeBody(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;

  return {
    name: trimmed(record.name),
    mobile: trimmed(record.mobile),
    email: blankToUndefined(trimmed(record.email)),
    visit_date: blankToUndefined(trimmed(record.visit_date)),
    note: blankToUndefined(trimmed(record.note)),
    status: blankToUndefined(trimmed(record.status)),
  };
}

function trimmed(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

function blankToUndefined(value: unknown): unknown {
  return value === '' ? undefined : value;
}

/**
 * The message for a set of rejected fields.
 *
 * One offending field gets copy that says what to do about it; several get the generic line, because
 * `use-form-submit.ts` shows one message against every field it is given and a specific sentence
 * would be wrong under all but one of them.
 */
function describeFields(fields: readonly string[]): string {
  if (fields.length !== 1) return 'Please check the details you entered.';

  switch (fields[0]) {
    case 'name':
      return `Enter their name, using ${NAME_MAX_LENGTH} characters or fewer.`;
    case 'mobile':
      return 'Enter their mobile number.';
    case 'email':
      return 'Enter a valid email address, or leave it blank.';
    case 'visit_date':
      return 'Enter the visit date as a real calendar date.';
    case 'note':
      return `Keep the note to ${NOTE_MAX_LENGTH} characters or fewer.`;
    case 'status':
      // Reachable two ways: a status on an add, and a status the platform owns. Both are the same
      // thing from the caller's side — this field is not theirs to set to that value.
      return 'That status is set from what happens on your review page, so it cannot be chosen here.';
    default:
      return 'Please check the details you entered.';
  }
}

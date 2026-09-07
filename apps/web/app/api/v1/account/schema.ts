/**
 * Wire contract for the SET-01 account endpoints.
 *
 * Hand-written rather than Zod, for the reason `api/v1/ai/modes/schema.ts` and
 * `readLinks` in `api/v1/business/links/route.ts` are: `packages/contracts` carries no account
 * DTO, and `zod` is not a dependency of `@ai-review/web`, so importing it here would be an
 * undeclared dependency. An `accountDetailsRequest` / `passwordChangeRequest` pair belongs beside
 * `signupRequest` in `packages/contracts`; until it does, this module is the single definition of
 * the wire shape and both the handlers and the screen read it, so the two cannot drift.
 *
 * The limits are mirrored, never invented. `full_name` and `mobile` copy `signupRequest`, which is
 * authoritative for the same two fields on the same column (`users.full_name` is varchar(120) and
 * `users.mobile` varchar(20), so the contract is the tighter of the two). Password bounds mirror
 * `PASSWORD_MIN_LENGTH` / `PASSWORD_MAX_LENGTH` in `@ai-review/core`, which stays authoritative
 * for strength — this module only refuses what could never be a password at all, so the handler
 * never hands a megabyte of text to Argon2id.
 *
 * This module imports nothing on purpose. It is read by a route handler and by a client component,
 * so a single server-only import here would either pull `pg` into the browser bundle or make the
 * screen impossible to build.
 */

/** signupRequest: full_name is 2-80. users.full_name is varchar(120), so 80 is the tighter cap. */
export const NAME_MIN = 2;
export const NAME_MAX = 80;

/** The RFC 5321 limit on an address. users.email is citext with no length cap of its own. */
export const EMAIL_MAX = 254;

/** signupRequest: mobile is 8-20. Shape is validated by normalizePhone in the handler. */
export const MOBILE_MIN = 8;
export const MOBILE_MAX = 20;

/** PASSWORD_MIN_LENGTH / PASSWORD_MAX_LENGTH in @ai-review/core. */
export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 256;

/**
 * A rejection names the fields to highlight, which is what `details.fields` carries in the error
 * envelope (23_API_Error_Codes.md) and what `SubmitFailure` reads on the client. Names are the
 * wire names, so one string identifies the input on both sides.
 */
export type ParseResult<T> =
  { ok: true; value: T } | { ok: false; message: string; fields: readonly string[] };

export interface AccountDetailsInput {
  fullName: string;
  email: string;
  mobile: string;
  /**
   * SET-01-01. Present only when the caller is changing the email address; absent for a name or
   * mobile edit. Null rather than undefined so "not sent" is a value the handler must consider
   * rather than a property it can forget to read.
   */
  currentPassword: string | null;
}

export interface PasswordChangeInput {
  currentPassword: string;
  newPassword: string;
}

/**
 * PATCH /api/v1/account.
 *
 * Every field is required: the endpoint replaces the account's details rather than patching one at
 * a time, so a screen that forgot a field cannot blank it by omission. Mobile is required for the
 * same reason AUTH-01 requires it at signup — every owner is expected to have one, and a settings
 * screen that allowed it to be cleared would let account data decay. `users.mobile` is nullable
 * because Flow B invites can create a user before an admin knows the number; such a user has to
 * supply one here before they can save, which is the intended direction of travel.
 */
export function parseAccountDetails(raw: unknown): ParseResult<AccountDetailsInput> {
  const record = asRecord(raw);
  if (!record) return invalid('Malformed request body.', ['body']);

  const fullName = readString(record.full_name).trim();
  if (fullName.length < NAME_MIN || fullName.length > NAME_MAX) {
    return invalid(`Use between ${NAME_MIN} and ${NAME_MAX} characters.`, ['full_name']);
  }

  const email = readString(record.email).trim();
  if (!looksLikeEmail(email)) {
    return invalid('Enter a valid email address.', ['email']);
  }

  const mobile = readString(record.mobile).trim();
  if (mobile.length < MOBILE_MIN || mobile.length > MOBILE_MAX) {
    return invalid('Enter a valid 10-digit mobile number.', ['mobile']);
  }

  // Not trimmed. A password is an opaque secret and trimming one silently changes it, so a
  // password containing a leading or trailing space would verify here and fail at the next login.
  const currentPassword =
    typeof record.current_password === 'string' ? record.current_password : '';

  return {
    ok: true,
    value: {
      fullName,
      email,
      mobile,
      currentPassword: currentPassword === '' ? null : currentPassword,
    },
  };
}

/**
 * POST /api/v1/account/password.
 *
 * The current password is checked for presence only. Its bounds are deliberately not enforced:
 * rejecting a too-short *current* password would answer a question about the stored credential
 * before the limiter or the hash comparison ever ran.
 */
export function parsePasswordChange(raw: unknown): ParseResult<PasswordChangeInput> {
  const record = asRecord(raw);
  if (!record) return invalid('Malformed request body.', ['body']);

  const currentPassword =
    typeof record.current_password === 'string' ? record.current_password : '';
  if (currentPassword === '') {
    return invalid('Enter your current password.', ['current_password']);
  }

  const newPassword = typeof record.new_password === 'string' ? record.new_password : '';
  if (newPassword.length < PASSWORD_MIN || newPassword.length > PASSWORD_MAX) {
    return invalid(`Use at least ${PASSWORD_MIN} characters.`, ['new_password']);
  }

  return { ok: true, value: { currentPassword, newPassword } };
}

/**
 * Whether a submitted address is a real change (SET-01-01).
 *
 * Case-insensitive because `users.email` is a citext column: `Owner@Example.com` and
 * `owner@example.com` are the same account to the database, so treating a change of case as a
 * change of address would demand a password for an edit that changes nothing. Whitespace is
 * trimmed for the same reason. The client mirrors this exact comparison to decide whether to ask
 * for the password, so both sides agree on what "changed" means.
 */
export function emailChanged(submitted: string, stored: string): boolean {
  return submitted.trim().toLowerCase() !== stored.trim().toLowerCase();
}

/**
 * Deliberately permissive: one @, no spaces, a dot in the domain, within the RFC length.
 *
 * `z.email()` in `packages/contracts` is authoritative for signup and this mirrors its intent
 * rather than its regex. Anything stricter rejects real addresses, and the only test that settles
 * whether an address exists is sending mail to it — which V1 has no flow for (see concerns).
 */
function looksLikeEmail(value: string): boolean {
  if (value.length === 0 || value.length > EMAIL_MAX) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function asRecord(raw: unknown): Record<string, unknown> | null {
  return typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : null;
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function invalid(message: string, fields: readonly string[]): ParseResult<never> {
  return { ok: false, message, fields };
}

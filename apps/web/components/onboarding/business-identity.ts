import type { SubmitFailure } from '../shared/forms/use-form-submit';

/**
 * ONB-01 — the pure logic behind BusinessStep.
 *
 * Split out of BusinessStep.tsx so it can be tested. This is the branch-heavy half of the screen —
 * which fields are required beyond what the contract enforces, which rejection code earns which
 * sentence, and how the three JSON payloads the screen reads are narrowed — and the unit suite
 * collects `*.test.ts` with no DOM, so none of it was reachable while it lived inside the
 * component. Nothing here touches React.
 *
 * Nothing here may import from '@ai-review/core' either: that package has a single root entry point
 * that re-exports the whole domain, so a value import would pull pg and @node-rs/argon2
 * into the browser bundle. Slug rules therefore arrive as numbers (BusinessStepRules), and
 * normalization stays on the server.
 */

/**
 * Mirrors businessIdentityRequest so the inputs can cap length as they are typed. The contract is
 * authoritative and is what actually gates the save; these only stop an owner writing 900
 * characters and then being told to cut them.
 */
export const NAME_MAX = 160;
export const DESCRIPTION_MAX = 500; // ONB-01: 0-500 (AMENDMENT-009 narrowed the column to match).
export const PLACE_MAX = 100;

export const FIELD_KEYS = [
  'name',
  'category',
  'description',
  'city',
  'state',
  'slug',
  'timezone',
] as const;
export type FieldKey = (typeof FIELD_KEYS)[number];
export type FieldErrors = Partial<Record<FieldKey, string>>;

export type BusinessIdentityValues = Record<FieldKey, string>;

/** What GET /api/v1/business/slug-available answers, once narrowed. */
export interface Availability {
  slug: string;
  available: boolean;
  reason: string | null;
  suggestions: readonly string[];
}

export interface SavedIdentity {
  slug: string;
  /** Flow I: the address this one replaced, which keeps redirecting rather than breaking. */
  previousSlug: string | null;
}

/**
 * What should happen after a save attempt, from WizardShell's point of view.
 *
 * - `blocked` — nothing was persisted; the screen has shown the reason.
 * - `hold-for-notice` — persisted, but this save replaced the page address. The shell must NOT
 *   navigate: the `saved` panel is the only place Flow I's "the old address keeps redirecting for
 *   N days" is ever said, and the shell unmounts the step on any truthy return.
 * - `leave` — persisted with nothing further to say.
 *
 * A function rather than two `if`s inside the component so the rule is testable: the bug it exists
 * to prevent is a disclosure that renders and is routed away from in the same tick.
 */
export type SaveOutcome = 'blocked' | 'hold-for-notice' | 'leave';

export function saveOutcome(identity: SavedIdentity | null): SaveOutcome {
  if (!identity) return 'blocked';
  return identity.previousSlug === null ? 'leave' : 'hold-for-notice';
}

export function isFieldKey(value: string): value is FieldKey {
  return (FIELD_KEYS as readonly string[]).includes(value);
}

/**
 * ONB-01 marks name, category, city, state and the address required.
 *
 * businessIdentityRequest does not enforce all of that — city and state are `z.string().max(100)`
 * with no minimum — so PATCH would accept an empty city, loadOnboardingProgress would then report
 * this step unfinished, and the owner would be sent back here with nothing visibly wrong. Enforced
 * here, and raised as a contract gap rather than left to this screen forever.
 */
export function requiredErrors(body: {
  name: string;
  category: string;
  city: string;
  state: string;
  slug: string;
}): FieldErrors {
  const errors: FieldErrors = {};
  if (body.name === '') errors.name = 'Enter your business name.';
  if (body.category === '') errors.category = 'Choose the category that fits best.';
  if (body.city === '') errors.city = 'Enter the city you operate in.';
  if (body.state === '') errors.state = 'Enter your state.';
  if (body.slug === '') errors.slug = 'Choose an address for your page.';
  return errors;
}

export function contractMessage(field: FieldKey, slugMin: number, slugMax: number): string {
  switch (field) {
    case 'name':
      return `Use between 2 and ${NAME_MAX} characters.`;
    case 'category':
      return 'That category is too long. Please pick one from the list.';
    case 'description':
      return `Keep the description to ${DESCRIPTION_MAX} characters or fewer.`;
    case 'city':
    case 'state':
      return `Use ${PLACE_MAX} characters or fewer.`;
    case 'slug':
      return `Use between ${slugMin} and ${slugMax} characters.`;
    case 'timezone':
      // Never entered on this screen; it is carried through from the tenant.
      return 'We could not save your timezone setting. Please contact support.';
  }
}

/** Shown for a rejection code this build has no copy for. */
export const UNKNOWN_REJECTION_COPY = 'That address cannot be used. Please choose another.';

/**
 * Copy for the rejection codes /business/slug-available returns.
 *
 * That endpoint answers with codes and no prose, so the wording lives here: every member of core's
 * SlugRejection, plus 'TAKEN', which the endpoint adds for an address that is legal but owned. Kept
 * in step with the messages PATCH /api/v1/business returns for the same codes, so an owner is never
 * told two different things about one rule — __tests__/business-identity.test.ts pins the whole set
 * against SlugRejection, so a new code cannot ship with only the generic fallback.
 *
 * `reason` is a string rather than that union because it arrives from JSON: an unrecognised code has
 * to degrade to a sentence, not throw.
 */
export function describeUnavailable(
  reason: string | null,
  slugMin: number,
  slugMax: number,
): string {
  switch (reason) {
    case 'TAKEN':
      return 'That address is already taken. Please choose another.';
    case 'TOO_SHORT':
      return `Use at least ${slugMin} characters.`;
    case 'TOO_LONG':
      return `Use at most ${slugMax} characters.`;
    case 'RESERVED':
      return 'That address is reserved. Please choose another.';
    case 'NUMERIC_ONLY':
      return 'Include at least one letter.';
    case 'INVALID_CHARACTERS':
      return 'Use only lowercase letters, numbers and hyphens.';
    case 'CONSECUTIVE_HYPHENS':
      return 'Avoid two hyphens in a row.';
    case 'LEADING_OR_TRAILING_HYPHEN':
      return 'Do not start or end with a hyphen.';
    default:
      return UNKNOWN_REJECTION_COPY;
  }
}

export function readAvailability(payload: unknown): Availability | null {
  const record = asRecord(payload);
  if (!record) return null;
  if (typeof record.slug !== 'string' || typeof record.available !== 'boolean') return null;

  return {
    slug: record.slug,
    available: record.available,
    reason: typeof record.reason === 'string' ? record.reason : null,
    suggestions: Array.isArray(record.suggestions)
      ? record.suggestions.filter((value): value is string => typeof value === 'string')
      : [],
  };
}

export function readSaved(payload: unknown, fallbackSlug: string): SavedIdentity {
  const record = asRecord(payload);
  if (!record) return { slug: fallbackSlug, previousSlug: null };

  return {
    slug: typeof record.slug === 'string' ? record.slug : fallbackSlug,
    previousSlug: typeof record.previous_slug === 'string' ? record.previous_slug : null,
  };
}

/**
 * The error envelope from 23_API_Error_Codes.md.
 *
 * components/shared/forms/use-form-submit.ts unpacks the same shape, but that hook only issues POSTs and
 * this screen saves with PATCH. The SubmitFailure type is imported rather than redeclared so the
 * two cannot drift apart in shape; generalising the hook to take a method would remove the
 * duplication outright, but that module is not this one's to change.
 *
 * Every member is probed rather than asserted, because this runs on whatever a proxy or an error
 * page actually put on the wire — `{ error: null }` and `{ error: 'boom' }` included. A TypeError
 * here would be caught by the save's own catch and reported as "could not reach the server", which
 * is a lie about what happened.
 */
export function readFailure(payload: unknown): SubmitFailure {
  const fallback: SubmitFailure = {
    code: 'INTERNAL_ERROR',
    message: 'Something went wrong. Please try again.',
    fields: [],
  };

  const error = asRecord(asRecord(payload)?.error);
  if (!error) return fallback;

  const fields = asRecord(error.details)?.fields;

  return {
    code: typeof error.code === 'string' ? error.code : fallback.code,
    message: typeof error.message === 'string' ? error.message : fallback.message,
    fields: Array.isArray(fields)
      ? fields.filter((value): value is string => typeof value === 'string')
      : [],
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

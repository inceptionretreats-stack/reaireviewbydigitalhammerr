import type { ReviewDestinationKind, ReviewUrlRejection } from '@ai-review/core';
import type { SubmitFailure } from '@/components/shared/forms/use-form-submit';

/**
 * ONB-02 — the decisions behind the Google review destination screen, separated from its markup.
 *
 * Everything here is either pure or operates on a plain object the component holds in a ref, so it
 * is unit-testable in `apps/web`, where no DOM test environment is available (jsdom and
 * @testing-library are devDependencies of `packages/ui` only). That is the house pattern for the
 * dashboard screens too — a sibling `.ts` module beside the component with the tests next to it —
 * and it is the only way the save/no-save and request-ordering rules below can be pinned by a test
 * rather than re-read by hand.
 *
 * Imports are type-only on purpose: `@ai-review/core` re-exports the argon2 hasher, the Redis rate
 * limiter and the Drizzle tenant guard from its barrel, none of which can exist in a browser bundle
 * or in a unit test. `import type` is erased under verbatimModuleSyntax, so this module has no
 * runtime dependencies at all.
 */

export const REQUIRED_MESSAGE =
  'Add your Google review link to continue — your business cannot be published without it.';

/**
 * A failed *check* is not a failed step: the save re-validates server-side anyway, so the copy says
 * so rather than implying the merchant's link is the problem.
 */
export const CHECK_FAILED_MESSAGE =
  'We could not check your link just now. You can still press Continue — the link is checked ' +
  'again when it is saved.';

/** Shown when the PUT fails with no usable error envelope (a proxy's 502 page, say). */
export const SAVE_FAILED_MESSAGE = 'We could not save your link just now. Please try again.';

/** The rejections that mean "you have the wrong link" — the ones the instructions actually fix. */
export const REASONS_WORTH_INSTRUCTIONS: readonly ReviewUrlRejection[] = [
  'UNSUPPORTED_HOST',
  'MISSING_PLACE_REFERENCE',
];

/** The verdict from the server-side validator, returned by the Server Action the page supplies. */
export type ReviewLinkCheck =
  | { ok: true; url: string; host: string; kind: ReviewDestinationKind }
  | { ok: false; reason: ReviewUrlRejection; message: string };

/** Which footer button the merchant pressed. They do not agree about an empty field. */
export type ReviewLinkIntent = 'continue' | 'save-and-exit';

export type ReviewLinkAction =
  /** Refuse and show REQUIRED_MESSAGE. */
  | 'require-value'
  /** Leave the step without a write. */
  | 'advance'
  /** PUT the value, then leave if it succeeded. */
  | 'save';

/**
 * What Continue / Save & exit should actually do, given what is typed and what is stored.
 *
 * Two of the three branches exist to avoid a write:
 *
 * - Unchanged since it was stored: advance without a PUT, because every PUT bumps
 *   `businesses.config_version` to invalidate the cached public configuration (AC-017), and
 *   passing back through this step must not churn that cache.
 * - Empty is refused by Continue but allowed by Save & exit. This step is not skippable — the
 *   publish route treats the review destination as its one genuinely non-negotiable prerequisite,
 *   so letting an empty field through Continue only defers the same failure to ONB-05, where it
 *   arrives with no clue which step caused it. Save & exit is not a skip (`/onboarding` resumes
 *   here and publish still refuses), and someone using it on this step is usually leaving in order
 *   to go and find the link; blocking the exit would strand them on it.
 */
export function decideReviewLinkAction(
  intent: ReviewLinkIntent,
  trimmed: string,
  storedUrl: string | null,
): ReviewLinkAction {
  if (trimmed.length === 0) return intent === 'continue' ? 'require-value' : 'advance';
  if (trimmed === storedUrl) return 'advance';
  return 'save';
}

/**
 * Whether leaving the field should trigger a validation request.
 *
 * Feedback the moment they leave the field, without a request per keystroke — and nothing when
 * there is nothing new to say about the current value: it is already the stored one, or a verdict
 * or an error for exactly this value is already on screen.
 */
export function shouldCheckOnBlur(state: {
  trimmed: string;
  isSaved: boolean;
  hasVerdict: boolean;
  hasError: boolean;
}): boolean {
  return state.trimmed.length > 0 && !state.isSaved && !state.hasVerdict && !state.hasError;
}

/**
 * The single in-flight slot the screen has for a server round trip.
 *
 * `issued` is a monotonic ticket handed to each request as it starts and the newest one owns the
 * slot; `value` is what that request was made for, nulled the moment the merchant edits. Two
 * different questions need both fields, and answering them from one is what left the spinner stuck:
 *
 * - *May this request clear the busy state?* — the ticket alone. A request whose value has since
 *   been edited away still has to release the spinner it started, or it spins forever; an older
 *   request settling behind a newer one must not release it, or the buttons come back mid-request.
 * - *May this verdict be displayed?* — the ticket **and** the value, so a slow answer can neither
 *   label text the merchant has since replaced nor overwrite what a later request has already said.
 */
export interface RequestSlot {
  value: string | null;
  issued: number;
  saving: boolean;
}

export function createRequestSlot(): RequestSlot {
  return { value: null, issued: 0, saving: false };
}

/**
 * Claim the slot for a validation check, or refuse it. Returns the request's ticket, or null when
 * the request must not be issued at all.
 *
 * Refused in two cases, both reachable from the keyboard and the mouse:
 *
 * - The same value is already in flight. Clicking "Validate link" blurs the input first, so the
 *   blur/click pair would otherwise be two identical round trips.
 * - A save is in flight. The PUT runs the same authoritative validator, so a check started now can
 *   only produce a redundant or contradictory verdict — and when it settled it would clear the
 *   wizard shell's "Saving" state while the PUT was still running.
 */
export function claimCheck(slot: RequestSlot, candidate: string): number | null {
  if (slot.saving) return null;
  if (slot.value === candidate) return null;

  slot.value = candidate;
  slot.issued += 1;
  return slot.issued;
}

/** Claim the slot for the PUT. A save always wins the slot: it is the operation that persists. */
export function claimSave(slot: RequestSlot, candidate: string): number {
  slot.value = candidate;
  slot.saving = true;
  slot.issued += 1;
  return slot.issued;
}

/**
 * Whether the request identified by `ticket` is still the newest one — so whether it owns the busy
 * state and must release it when it settles.
 */
export function ownsSlot(slot: RequestSlot, ticket: number): boolean {
  return slot.issued === ticket;
}

/** Whether an answer for `candidate` from request `ticket` still describes what is on screen. */
export function ownsVerdict(slot: RequestSlot, ticket: number, candidate: string): boolean {
  return ownsSlot(slot, ticket) && slot.value === candidate;
}

/**
 * Release the slot once request `ticket` settles, whatever it returned. Cleared even when the
 * answer was discarded, so pressing "Validate link" again always re-runs; a superseded request
 * releases nothing, because the slot no longer describes it.
 */
export function settle(slot: RequestSlot, ticket: number): void {
  if (!ownsSlot(slot, ticket)) return;
  slot.value = null;
  slot.saving = false;
}

/** Any edit invalidates what is displayed and any answer still in flight. */
export function invalidate(slot: RequestSlot): void {
  slot.value = null;
}

/**
 * One JSON mutation's outcome, with the error envelope unpacked (23_API_Error_Codes).
 */
export type JsonResult =
  { ok: true; payload: Record<string, unknown> } | { ok: false; failure: SubmitFailure };

/**
 * Unpacks `{ error: { code, message, details: { fields } } }`, falling back whole-hog when the body
 * is not that shape. The API returns a specific message per rejection reason and it is displayed
 * verbatim, because a generic "invalid link" hides which of four different mistakes this was.
 */
export function readFailure(payload: Record<string, unknown>): SubmitFailure {
  const fallback: SubmitFailure = {
    code: 'INTERNAL_ERROR',
    message: SAVE_FAILED_MESSAGE,
    fields: [],
  };

  const error = payload.error;
  if (typeof error !== 'object' || error === null) return fallback;

  const { code, message, details } = error as Record<string, unknown>;
  const fields = (details as { fields?: unknown } | null | undefined)?.fields;

  return {
    code: typeof code === 'string' ? code : fallback.code,
    message: typeof message === 'string' ? message : fallback.message,
    fields: Array.isArray(fields) ? fields.filter((f): f is string => typeof f === 'string') : [],
  };
}

/** The normalized URL the API stored, which is what gets shown back (ONB-02-03). */
export function readUrl(payload: Record<string, unknown>): string | null {
  const { url } = payload;
  return typeof url === 'string' && url.length > 0 ? url : null;
}

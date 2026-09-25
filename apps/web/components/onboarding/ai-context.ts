import type { SubmitFailure } from '@/components/shared/forms/use-form-submit';

/**
 * The framework-free half of ONB-04 — everything the AI-context step decides, separated from what
 * it renders.
 *
 * It lives beside the screen rather than inside it for two reasons. The step's own logic (envelope
 * parsing, the preview state machine, the stale-preview signature) is where a quiet mistake shows
 * up as a wrong or dishonest message rather than as a crash, and it was untested because a `.tsx`
 * module cannot be reached by the shared Vitest config (`**\/*.test.ts` only, and `apps/web` has
 * no DOM testing dependency). The second reason is `toStringArray`: the Server Component page needs
 * it too, and a Server Component may not import a value from a `'use client'` module.
 */

/** `aiContextRequest` caps the summary at 2000; mirrored so a long summary cannot 422 on save. */
export const SUMMARY_MAX = 2000;

/** Show the remaining count only near the limit — a counter that ticks from 2000 is noise. */
export const SUMMARY_COUNTER_FROM = 200;

/**
 * Thresholds at which the character count is *announced*, ascending.
 *
 * The visible counter updates on every keystroke, which is right for a sighted user and wrong for
 * a live region: a polite region queues one utterance per character, so an owner using a screen
 * reader hears "199 characters left", "198 characters left" … over their own typing echo. Bucketing
 * the announcement means the region's text changes four times in the last 200 characters instead of
 * two hundred, while the visible number stays exact (AC-037 asks for usable, not merely present).
 */
export const SUMMARY_ANNOUNCE_AT: readonly number[] = [20, 50, 100];

/** Exact, per-keystroke text for the visible counter. */
export function summaryCounterText(remaining: number): string {
  if (remaining > SUMMARY_COUNTER_FROM) return '';
  return `${Math.max(0, remaining)} characters left of ${SUMMARY_MAX}.`;
}

/**
 * Milestone text for the live region. Returns the same string for every keystroke inside a bucket,
 * so a screen reader announces once per crossing rather than once per character.
 *
 * "N or fewer" rather than a bare number, because the announced value is the bucket and not the
 * exact remainder: at 43 characters left the region says "50 characters or fewer", which is true,
 * where "about 50" would be a small inaccuracy repeated at every threshold.
 */
export function summaryAnnouncement(remaining: number): string {
  if (remaining <= 0) return `Business summary is full at ${SUMMARY_MAX} characters.`;

  const milestone = SUMMARY_ANNOUNCE_AT.find((threshold) => remaining <= threshold);
  if (milestone === undefined) return '';

  return `${milestone} characters or fewer left of ${SUMMARY_MAX}.`;
}

/** The name PUT /ai/context gives the mode it creates on first save (route.ts DEFAULT_MODE_NAME). */
export const DEFAULT_MODE_NAME = 'Balanced';

export interface ModeState {
  /** Name of the active, unarchived mode, or null when the tenant has none. */
  readonly activeModeName: string | null;
  /**
   * Whether the tenant has any `review_modes` row at all, archived or inactive included. This is
   * the condition PUT /ai/context actually tests (`existingModes.length === 0`), so it is the only
   * thing that decides whether saving creates Balanced.
   */
  readonly hasAnyMode: boolean;
}

export interface DefaultModeCopy {
  readonly title: string;
  readonly note: string | null;
}

/**
 * What the "Default review mode" card may truthfully say.
 *
 * The dishonest version of this promised "Balanced — set up for you when you save this step"
 * whenever no *active* mode was found. PUT /ai/context creates Balanced only when the tenant has no
 * review_modes rows whatsoever, so a business whose modes are all archived or all switched off was
 * being promised an outcome the save cannot deliver. Three states, three sentences — and the third
 * one says what is actually true, which is that generation falls back to the business details alone
 * (`loadGenerationContext` returns `reviewMode: null`).
 */
export function defaultModeCopy({ activeModeName, hasAnyMode }: ModeState): DefaultModeCopy {
  if (activeModeName !== null) return { title: activeModeName, note: null };

  if (!hasAnyMode) {
    return {
      title: DEFAULT_MODE_NAME,
      note: 'Set up for you when you save this step.',
    };
  }

  return {
    title: 'None switched on',
    note:
      'Your review modes are all switched off or archived, so drafts use your business details on ' +
      'their own. Switch one on in Ai settings whenever you like.',
  };
}

/** The four states ONB-04 requires: default (`idle`), preview loading, preview ready, AI error. */
export type PreviewState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; draft: string; compliancePassed: boolean; signature: string }
  | { status: 'error'; message: string };

export const EMPTY_PREVIEW_MESSAGE = 'The preview came back empty. Please try generating it again.';

/**
 * Turns a 200 from /ai/test-preview into the state the card renders.
 *
 * An empty or non-string `review_text` becomes the error state rather than an empty quotation:
 * a blockquote with nothing in it reads as "this is what your customers get", which would be the
 * one thing this screen must never imply.
 *
 * `compliance_passed` is treated as passed when absent, so an unexpected payload shape cannot raise
 * a false alarm; when it is explicitly false the owner is told, because a draft a customer would
 * never be shown is not a fair sample of the product (AC-011, AC-012).
 */
export function previewFromPayload(
  payload: Record<string, unknown>,
  signature: string,
): PreviewState {
  const draft = typeof payload.review_text === 'string' ? payload.review_text : '';

  if (draft.trim() === '') return { status: 'error', message: EMPTY_PREVIEW_MESSAGE };

  return {
    status: 'ready',
    draft,
    compliancePassed: payload.compliance_passed !== false,
    signature,
  };
}

/**
 * Identifies the context a draft was generated from, so a preview can admit it predates the
 * owner's latest edits rather than appearing to reflect them.
 */
export function contextSignature(
  summary: string,
  services: readonly string[],
  contextTerms: readonly string[],
  draftLanguage: string,
): string {
  // The language is part of what a draft was generated from: switching it and looking at a
  // preview written in the other one is the most misleading stale preview there is.
  return JSON.stringify([summary.trim(), services, contextTerms, draftLanguage]);
}

/** True when a ready preview was generated from context the owner has since edited. */
export function previewIsStale(preview: PreviewState, signature: string): boolean {
  return preview.status === 'ready' && preview.signature !== signature;
}

/**
 * `services` and `context_terms` are jsonb with no `$type<string[]>()`, so Drizzle hands them back
 * as `unknown`. Narrowing rather than casting: the column is only ever written through
 * `aiContextRequest`, but a hand-edited or seeded row can hold anything, and a bad value would
 * otherwise crash the step instead of degrading to an empty list.
 */
export function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

export type JsonResult =
  { ok: true; payload: Record<string, unknown> } | { ok: false; failure: SubmitFailure };

/**
 * One JSON call with the error envelope from 23_API_Error_Codes.md unpacked.
 *
 * `useFormSubmit` is not reused: it is POST-only and binds one endpoint per instance, and this
 * screen needs a PUT to /ai/context and a POST to /ai/test-preview. Its `SubmitFailure` type is
 * imported so the two cannot drift in what they surface to a person. `components/dashboard/ai-review`
 * carries a near-identical copy of this for AI-01/AI-02; both files say so, and the shared home in
 * `lib/` is still owed.
 *
 * No CSRF token is threaded through: `verifyCsrf` checks the Origin header, which the browser sets
 * on a same-origin mutation by itself.
 */
export async function sendJson(
  endpoint: string,
  method: 'POST' | 'PUT',
  body: Record<string, unknown>,
): Promise<JsonResult> {
  let response: Response;

  try {
    response = await fetch(endpoint, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    // A network failure, not a rejected request: says so rather than implying an entry is wrong.
    return {
      ok: false,
      failure: {
        code: 'NETWORK',
        message: 'Could not reach the server. Check your connection and try again.',
        fields: [],
      },
    };
  }

  const payload = await readJsonBody(response);
  return response.ok ? { ok: true, payload } : { ok: false, failure: readFailure(payload) };
}

/**
 * A body that is missing or not JSON (a proxy's 502 page) is treated as an empty one.
 *
 * An array is excluded along with the primitives: it is `typeof 'object'`, so the obvious check
 * would cast one to `Record<string, unknown>` and hand the caller a value whose declared type is a
 * lie. No endpoint in 08_OpenAPI_v1.yaml returns a top-level array, and treating one as an empty
 * payload lands on the honest "the preview came back empty" path.
 */
export async function readJsonBody(response: Response): Promise<Record<string, unknown>> {
  if (response.status === 204) return {};

  try {
    const parsed: unknown = await response.json();
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function readFailure(payload: Record<string, unknown>): SubmitFailure {
  const fallback: SubmitFailure = {
    code: 'INTERNAL_ERROR',
    message: 'Something went wrong. Please try again.',
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

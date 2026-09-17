'use client';

import { useCallback, useState } from 'react';
import type { SubmitFailure, SubmitState } from '../../auth/use-form-submit';

/**
 * Submit plumbing for the three SET-01 forms.
 *
 * `components/auth/use-form-submit.ts` is the same idea and would be the right home for this, but
 * it posts unconditionally and `PATCH /api/v1/account` is a PATCH. Its `SubmitFailure` and
 * `SubmitState` types are imported rather than restated so the two cannot disagree about the shape
 * of a failure, and `fieldError` from that module works on this state unchanged. What is duplicated
 * is the envelope unpacking, which should be folded back into one hook that takes a method — see
 * concerns; that file is outside this module's paths.
 *
 * The API returns a safe, user-facing `message` for every failure (23_API_Error_Codes.md), so the
 * string is displayed verbatim rather than remapped here, and `details.fields` marks which inputs
 * to highlight.
 */

export type SettingsMethod = 'POST' | 'PATCH' | 'PUT';

export interface SettingsSubmit {
  state: SubmitState;
  submit: (body: Record<string, unknown>) => Promise<SubmitState>;
  reset: () => void;
}

export function useSettingsSubmit(endpoint: string, method: SettingsMethod): SettingsSubmit {
  const [state, setState] = useState<SubmitState>({ status: 'idle' });

  const submit = useCallback(
    async (body: Record<string, unknown>): Promise<SubmitState> => {
      setState({ status: 'submitting' });

      let next: SubmitState;
      try {
        const response = await fetch(endpoint, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        const payload: unknown = response.status === 204 ? {} : await response.json();

        next = response.ok
          ? { status: 'success', payload: asRecord(payload) }
          : { status: 'error', failure: readFailure(payload) };
      } catch {
        // A network failure, not a rejected request. Says so, rather than implying the details
        // were wrong — which on a password form would send the owner hunting for a typo.
        next = {
          status: 'error',
          failure: {
            code: 'NETWORK',
            message: 'Could not reach the server. Check your connection and try again.',
            fields: [],
          },
        };
      }

      setState(next);
      return next;
    },
    [endpoint, method],
  );

  /** Clears the state so a field-level correction does not sit under a stale message. */
  const reset = useCallback(() => setState({ status: 'idle' }), []);

  return { state, submit, reset };
}

/**
 * The message for a failure that names no field the form is currently showing, or null.
 *
 * A server rejection is only visible if something on screen carries it. `fieldError` puts the
 * message beside an input when `details.fields` names one, but two rejections name a field that
 * may not be rendered at all: `PATCH /api/v1/account` answers `['current_password']` whenever the
 * address changed relative to the STORED one — which the client cannot know, because it compares
 * against the address this browser last saw — and `parseAccountDetails` answers `['body']`, which
 * is not an input at all. Gating the banner on an EMPTY field list therefore silently drops both:
 * the owner presses Save, the request is refused, and the screen says nothing.
 *
 * So the test is intersection, not emptiness — if none of the named fields is on screen, the
 * message belongs in the banner (AC-037: a refusal has to be perceivable).
 */
export function unattachedFailure(
  state: SubmitState,
  renderedFields: readonly string[],
): string | null {
  if (state.status !== 'error') return null;
  const shown = state.failure.fields.some((field) => renderedFields.includes(field));
  return shown ? null : state.failure.message;
}

/** Reads a value the server sent back, defaulting rather than throwing on an unexpected payload. */
export function readBoolean(state: SubmitState, key: string): boolean {
  return state.status === 'success' && state.payload[key] === true;
}

/** Same, for the session counts these endpoints return. Negative or absent reads as zero. */
export function readCount(state: SubmitState, key: string): number {
  if (state.status !== 'success') return 0;
  const value = state.payload[key];
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function readFailure(payload: unknown): SubmitFailure {
  const fallback: SubmitFailure = {
    code: 'INTERNAL_ERROR',
    message: 'Something went wrong. Please try again.',
    fields: [],
  };

  if (typeof payload !== 'object' || payload === null || !('error' in payload)) return fallback;

  const error = (payload as { error: Record<string, unknown> }).error;
  const details = error.details as { fields?: unknown } | undefined;

  return {
    code: typeof error.code === 'string' ? error.code : fallback.code,
    message: typeof error.message === 'string' ? error.message : fallback.message,
    fields: Array.isArray(details?.fields)
      ? details.fields.filter((field): field is string => typeof field === 'string')
      : [],
  };
}

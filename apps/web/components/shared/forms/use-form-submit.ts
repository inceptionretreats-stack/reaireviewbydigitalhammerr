'use client';

import { useCallback, useState } from 'react';

/**
 * Shared submit plumbing for the auth forms.
 *
 * Exists because all four screens need the same states — the screen spec lists `default`,
 * `submitting`, an error state and `success` for each — and because the error envelope in
 * 23_API_Error_Codes.md is uniform, so unpacking it four times would be four chances to diverge.
 *
 * The API returns a safe, user-facing `message` for every failure, so that string is displayed
 * verbatim rather than being remapped here. `details.fields` marks which inputs to highlight.
 */

export interface SubmitFailure {
  code: string;
  message: string;
  fields: string[];
  retryAfterSeconds?: number;
}

export type SubmitState =
  | { status: 'idle' }
  | { status: 'submitting' }
  | { status: 'error'; failure: SubmitFailure }
  | { status: 'success'; payload: Record<string, unknown> };

export function useFormSubmit(endpoint: string) {
  const [state, setState] = useState<SubmitState>({ status: 'idle' });

  const submit = useCallback(
    async (body: Record<string, unknown>): Promise<SubmitState> => {
      setState({ status: 'submitting' });

      let next: SubmitState;
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        const payload: unknown = response.status === 204 ? {} : await response.json();

        next = response.ok
          ? { status: 'success', payload: asRecord(payload) }
          : { status: 'error', failure: readFailure(payload) };
      } catch {
        // A network failure, not a rejected request. Says so, rather than implying the details
        // were wrong.
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
    [endpoint],
  );

  /** Clears an error so a field-level correction does not sit under a stale message. */
  const reset = useCallback(() => setState({ status: 'idle' }), []);

  return { state, submit, reset };
}

/** True when this field was named in the failure, so the form can mark it invalid. */
export function fieldError(state: SubmitState, field: string): string | null {
  if (state.status !== 'error') return null;
  return state.failure.fields.includes(field) ? state.failure.message : null;
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
      ? details.fields.filter((f): f is string => typeof f === 'string')
      : [],
  };
}

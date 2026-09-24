'use client';

import type { SubmitFailure } from '@/components/shared/forms/use-form-submit';

/**
 * One JSON call with the error envelope from 23_API_Error_Codes.md unpacked.
 *
 * `useFormSubmit` is not reused because it is POST-only and binds a single endpoint per instance,
 * while AI-01 needs a PUT to `/ai/context` and a POST to `/ai/test-preview`, and AI-02 needs POST
 * and PATCH across three endpoints. Its `SubmitFailure` type is imported rather than redeclared, so
 * what the two surface to a person cannot drift.
 *
 * `components/onboarding/AiContextStep.tsx` still carries a near-identical private copy of this;
 * folding it into this shared helper is a known follow-up.
 *
 * The API returns a safe, user-facing message for every failure, so it is displayed verbatim rather
 * than remapped: remapping is how a 429's "wait and retry" becomes a useless "something went
 * wrong".
 *
 * No CSRF token is threaded through. `verifyCsrf` checks the Origin header, which the browser sets
 * on a same-origin mutation by itself.
 */

export type JsonResult =
  { ok: true; payload: Record<string, unknown> } | { ok: false; failure: SubmitFailure };

export async function sendJson(
  endpoint: string,
  method: 'POST' | 'PUT' | 'PATCH',
  body?: Record<string, unknown>,
): Promise<JsonResult> {
  let response: Response;

  try {
    response = await fetch(endpoint, {
      method,
      // A body-less POST (activate) sends no Content-Type either: declaring JSON and sending
      // nothing is what makes `request.json()` throw on the server for a request that is correct.
      ...(body === undefined
        ? {}
        : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    });
  } catch {
    // A network failure, not a rejected request: says so, rather than implying an entry is wrong.
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

/** A body that is missing or not JSON — a proxy's 502 page — is treated as an empty one. */
async function readJsonBody(response: Response): Promise<Record<string, unknown>> {
  if (response.status === 204) return {};

  try {
    const parsed: unknown = await response.json();
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function readFailure(payload: Record<string, unknown>): SubmitFailure {
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

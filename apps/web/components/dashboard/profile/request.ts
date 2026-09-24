import type { SubmitFailure } from '@/components/shared/forms/use-form-submit';

/**
 * One JSON mutation, with the error envelope of 23_API_Error_Codes.md unpacked.
 *
 * The same helper the onboarding steps carry, widened to the methods this screen needs: PROFILE-01
 * saves with PATCH, reorders with POST and removes with DELETE, while `useFormSubmit` is POST-only
 * and `LinksStep`'s copy is POST/PUT. That is now a fourth copy of this function in `apps/web`, and
 * the real fix is still one helper in `apps/web/lib` that every screen imports — a path outside this
 * module. Keeping the body identical apart from the method union is what makes that extraction a
 * delete rather than a merge. See concerns.
 *
 * The API returns a safe, user-facing `message` for every failure, so it is displayed verbatim
 * rather than remapped here; `details.fields` names the input to mark. AC-030 keeps provider detail
 * and stack traces on the server side of that line, which is why there is nothing else to unpack.
 */

export type JsonResult =
  { ok: true; payload: Record<string, unknown> } | { ok: false; failure: SubmitFailure };

export type MutationMethod = 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export async function sendJson(
  endpoint: string,
  method: MutationMethod,
  body?: Record<string, unknown>,
): Promise<JsonResult> {
  let response: Response;

  try {
    response = await fetch(endpoint, {
      method,
      ...(body === undefined
        ? {}
        : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    });
  } catch {
    // A network failure, not a rejected request: says so rather than implying the input is wrong.
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
    message: 'We could not save that just now. Please try again.',
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

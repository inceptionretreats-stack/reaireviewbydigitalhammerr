import type { NextResponse } from 'next/server';
import { apiError } from './api-error';

/**
 * Reading a JSON request body without ever letting it become a 500.
 *
 * Two shapes reached the handlers and crashed them, both from unauthenticated callers:
 *
 *  - A body of literal `null`. It is valid JSON, so `request.json()` resolves and the
 *    try/catch around it never fires; the handler then dereferences `body.slug` (or
 *    destructures it) and throws a TypeError outside any catch. Next answers 500 with a
 *    zero-length body — no error envelope, no code, no request_id, nothing traceable.
 *    Every other malformed root (`[]`, `"x"`, `7`, empty) already answered a clean 422,
 *    so only `null` was unguarded.
 *
 *  - An escaped `\u0000` inside any string. Zod's `z.string()` permits it, and PostgreSQL
 *    rejects it at execution time with `invalid byte sequence for encoding "UTF8"`, far
 *    past the point where the handler could answer politely.
 *
 * So the root is narrowed to a plain object here, and NUL is stripped from every string
 * before validation. Stripping rather than refusing is deliberate: a NUL arrives by
 * accident — pasted from a file or a legacy CRM export — never as something the customer
 * meant to type, and refusing their message outright would be a worse answer than quietly
 * dropping a byte that cannot be stored in any case.
 */

export type JsonObjectResult =
  | { readonly ok: true; readonly body: Record<string, unknown> }
  | { readonly ok: false; readonly response: NextResponse };

/** Depth cap: a body is a payload, not a data structure to recurse through without bound. */
const MAX_DEPTH = 24;

/**
 * Strips characters PostgreSQL cannot store in a `text` column: U+0000, and unpaired
 * surrogates, which have no valid UTF-8 encoding. Paired surrogates (every emoji and every
 * astral character) are left exactly as they are — AMENDMENT-026 is explicit that the
 * customer's emoji must survive the round trip byte for byte.
 */
export function stripUnstorable(value: string): string {
  // no-control-regex is off for these two lines specifically: matching U+0000 is the whole
  // purpose of the function, and it is the one control character PostgreSQL cannot store.
  // eslint-disable-next-line no-control-regex
  if (!/[\u0000\uD800-\uDFFF]/.test(value)) return value;
  return (
    value
      // eslint-disable-next-line no-control-regex
      .replace(/\u0000/g, '')
      .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '')
      .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
  );
}

function sanitise(value: unknown, depth: number): unknown {
  if (typeof value === 'string') return stripUnstorable(value);
  if (depth >= MAX_DEPTH || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => sanitise(item, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[stripUnstorable(key)] = sanitise(item, depth + 1);
  }
  return out;
}

/**
 * Reads the body as a JSON object, or returns the response to send.
 *
 * `null`, arrays, strings, numbers, booleans and unparseable input all answer the same
 * 422 the handlers already answered for every root but `null` — the caller sent something
 * that is not a request object, and which one it was is not information worth returning.
 */
export async function readJsonObject(request: Request): Promise<JsonObjectResult> {
  let raw: unknown;

  try {
    raw = await request.json();
  } catch {
    return { ok: false, response: apiError('VALIDATION_FAILED', 'Malformed request body.') };
  }

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, response: apiError('VALIDATION_FAILED', 'Malformed request body.') };
  }

  return { ok: true, body: sanitise(raw, 0) as Record<string, unknown> };
}

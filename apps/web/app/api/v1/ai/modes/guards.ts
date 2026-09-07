import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';

/**
 * Request-level guards shared by the three review-mode handlers.
 *
 * Both of these exist once rather than three times because a guard that is easy to forget in one
 * handler is a guard that will be forgotten in one handler.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `true` when the path segment could be a mode id at all.
 *
 * Checked before the query rather than trusted into it: a non-uuid makes Postgres raise 22P02,
 * which would surface as a 500 for what is plainly a request for something that does not exist.
 * `api/v1/qr/[id]/download/route.ts` does the same, and the pattern wants a home in `lib/` once a
 * third route needs it.
 */
export function isModeId(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/**
 * The single not-found answer for this endpoint family.
 *
 * "Absent/inaccessible" in 23_API_Error_Codes.md is one code for both cases on purpose: a mode that
 * does not exist and a mode belonging to another tenant must be reported identically, or the
 * endpoint becomes an existence oracle for other tenants' ids (AC-003).
 */
export function modeNotFound(): NextResponse {
  return apiError('RESOURCE_NOT_FOUND', 'We could not find that review mode.');
}

/**
 * Refuses a configuration change from a tenant that is suspended or closed.
 *
 * `requireActiveTenant` is deliberately not used here even though this is a mutation. It demands
 * status ACTIVE, and a DRAFT tenant is precisely who needs these screens: an owner sets up modes
 * and AI context before publishing, and `PUT /ai/context` is reachable from the wizard for the same
 * reason. So the check is inverted — DRAFT and ACTIVE may write, SUSPENDED and CLOSED may not,
 * which is what Flow J means by an admin suspension being more than cosmetic ("no AI generation",
 * and by extension no changing what the AI would produce). The error code is the same
 * BUSINESS_NOT_ACTIVE, so the client sees one consistent answer.
 *
 * Reads are not gated: a suspended owner still needs to see their own configuration in order to
 * understand what was suspended.
 */
export function refuseFrozenTenant(status: string): NextResponse | null {
  if (status === 'DRAFT' || status === 'ACTIVE') return null;
  return apiError('BUSINESS_NOT_ACTIVE', 'This business is not active.');
}

import { HOUR_MS, rateLimitKey, type RateLimitCheck, type ResolvedTenant } from '@ai-review/core';

/**
 * The rate-limit dimensions for POST /ai/test-preview (ONB-04, AI-01).
 *
 * Bypassing QuotaService is required — ONB-04-02 and AI-01-01 both say a preview must not consume
 * free quota — but it removes the only other bound on the endpoint. A Free business is capped at
 * ten lifetime *customer* generations by the Postgres counter (AC-013); a preview counts against
 * nothing, so without a window here an owner holding Enter on "Generate preview" makes unbounded
 * paid provider calls. 05_RBAC_Permissions.md already says an owner's own generation is allowed
 * "via public preview/test rules" — these are those rules.
 *
 * Two dimensions, for the same reason the public generation check has a burst rule
 * (09_AI_Prompt_and_Generation_Spec.md "Abuse controls"): an hourly cap alone lets a loop spend the
 * whole hour's allowance in a second, and the burst rule is what names that behaviour when it is
 * refused. Sized above real use — an owner tweaks a summary and looks again; nobody reads twenty
 * drafts an hour — and far below what a script produces.
 *
 * Kept beside the route rather than inside it because a Next route module may only export its HTTP
 * methods, and a limit nobody can test is a limit nobody can trust.
 */

export const PREVIEW_BURST_LIMIT = 3;
export const PREVIEW_BURST_WINDOW_MS = 30 * 1000;
export const PREVIEW_HOURLY_LIMIT = 20;
export const PREVIEW_HOURLY_WINDOW_MS = HOUR_MS;

/**
 * Composed check for one tenant.
 *
 * Keyed on the business, not on the user or the session: the provider bill is per business, and
 * two owners of one business sharing the window is the correct reading of that.
 *
 * It takes a `ResolvedTenant` rather than a string, which is a security property and not decoration
 * (RBAC rule 2, AC-003): a window keyed on an id from the request body would be bypassable by
 * sending a different id on every call, and the branded type makes that a compile error instead of
 * a code review someone has to remember.
 *
 * `onStoreUnavailable: 'DENY'` is the opposite of the public generation check, deliberately.
 * AC-035 protects the *customer* flow, which this endpoint is not on, and the quota counter that
 * makes failing open defensible there (rate-limit/service.ts, point 2) is exactly what this
 * endpoint does not consult. With no backstop, a Redis outage that failed open here would be an
 * unmetered spend window. The cost of failing closed is that previews pause during an outage,
 * which the step already handles: an AI failure never blocks Continue (AC-036), and ONB-04 says so
 * on screen.
 *
 * 23_API_Error_Codes.md has no code for an authenticated tool's own limit. FAIR_USE_THROTTLED
 * ("paid abuse/fair-use protection triggered", 429) is the closest true one: the subject is a
 * tenant and the concern is provider spend. PUBLIC_RATE_LIMITED is documented as the *anonymous*
 * generation/feedback limit and AUTH_RATE_LIMITED as the login window, so either would misdescribe
 * this caller. The "soft alerts, no hidden hard cap" half of D-006 is about the customer
 * generations a business pays for, not about the owner's own preview button.
 */
export function previewCheck(businessId: ResolvedTenant): RateLimitCheck {
  return {
    name: 'ai_preview',
    dimensions: [
      {
        rule: {
          name: 'ai.preview_burst',
          limit: PREVIEW_BURST_LIMIT,
          windowMs: PREVIEW_BURST_WINDOW_MS,
          code: 'FAIR_USE_THROTTLED',
          enforcement: 'ENFORCE',
        },
        key: rateLimitKey('ai.preview_burst', businessId),
      },
      {
        rule: {
          name: 'ai.preview_hourly',
          limit: PREVIEW_HOURLY_LIMIT,
          windowMs: PREVIEW_HOURLY_WINDOW_MS,
          code: 'FAIR_USE_THROTTLED',
          enforcement: 'ENFORCE',
        },
        key: rateLimitKey('ai.preview_hourly', businessId),
      },
    ],
    onStoreUnavailable: 'DENY',
  };
}

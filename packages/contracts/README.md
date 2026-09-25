# @ai-review/contracts — API request and response schemas

This package holds the Zod schemas for the JSON bodies and query strings of the HTTP API in
`apps/web/app/api/v1`. Read it when you add or change an endpoint, a form that posts to one, or a
field rule. One definition per payload is shared by the browser form and the route handler, so a
field cannot be validated one way on the client and another on the server. The server-side check
is always the one that counts.

## Files

Everything is re-exported from `src/index.ts`. Each schema has a matching
`type X = z.infer<typeof x>`.

| File                  | Area                                     |
| --------------------- | ---------------------------------------- |
| `src/public.ts`       | Anonymous customer flow (QR / slug page) |
| `src/auth.ts`         | Sign-up, sign-in, password reset, MFA    |
| `src/business.ts`     | Vendor onboarding and workspace          |
| `src/subscription.ts` | Pro checkout                             |
| `src/admin.ts`        | Admin console                            |

What each file declares:

- **`public.ts`**: `generateReviewRequest`, `generateReviewResponse`, `submitFeedbackRequest`,
  `publicEventRequest`, `publicBusinessResponse`.
- **`auth.ts`**: `signupRequest`, `loginRequest`, `forgotPasswordRequest`, `resetPasswordRequest`,
  `mfaCode`, `mfaChallengeRequest`, `mfaEnrolConfirmRequest`, `mfaRecoveryRequest`,
  `inviteAcceptRequest`.
- **`business.ts`**: `businessIdentityRequest`, `reviewDestinationRequest`, `aiContextRequest`,
  `qrSourceRequest`, `customerRequest`, `billingDetailsRequest`, plus `DRAFT_LANGUAGES` and
  `DEFAULT_DRAFT_LANGUAGE`.
- **`subscription.ts`**: `checkoutVerifyRequest`, the Razorpay Checkout success payload under
  Razorpay's own field names.
- **`admin.ts`**: `adminBusinessAction`, `adminBusinessListQuery`, `adminSettingsPatch`, the
  prompt-version inputs, `adminRole`, `adminTeamInvite`, `adminTeamAction`, `adminMfaReset`,
  `adminActivityQuery`, the payment and webhook list queries, `adminPaymentRefund`,
  `adminPaymentAction`.

Rules worth knowing before you edit:

- Public schemas carry only public identifiers (`slug`, `qr_code`). The business is resolved on
  the server; no internal UUID crosses the boundary.
- Every admin mutation requires a `reason`, because it is written to the audit log.
- `signupRequest.accept_terms` is the literal `true`, not a boolean.
- These schemas check shape. The authoritative business rules (slug syntax, the Google review-link
  host list, password strength) live in `@ai-review/core`.

## Relationship to the OpenAPI file

These schemas are the authority for field constraints. The maintained API description,
[`docs/openapi/v1.yaml`](../../docs/openapi/v1.yaml), follows them: where the YAML and a Zod
contract disagree, the YAML is wrong. When you change a schema here, update the YAML in the same
change (see [`docs/openapi/README.md`](../../docs/openapi/README.md)).

Not every route uses its contract yet. `generateReviewRequest`, `publicEventRequest` and
`reviewDestinationRequest` are exported, but their routes parse bodies locally; the OpenAPI README
lists these gaps.

## Who uses it

`apps/web` only: route handlers under `app/api/v1/`, helpers in `lib/` (admin, CRM customers, QR
sources, draft language) and client forms (onboarding, profile editor, feedback form). The package
depends only on `zod`, so it is safe to import in browser code.

Tests: `src/__tests__/public-service-selection.test.ts` (run with `pnpm test`).

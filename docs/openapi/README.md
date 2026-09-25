# docs/openapi — the maintained V1 contract

> **Status: partial and partly out of date.** `v1.yaml` documents 21 paths; `apps/web/app/api/v1`
> has 71 route files. Whole areas are missing (see below), and some statements inside `v1.yaml`
> predate fixes in the code (listed under [known gaps](#known-gaps-in-v1yaml-itself)). Use
> [routes](../architecture/routes.md) for the full route map, and the route handlers themselves for
> current behaviour.

`v1.yaml` in this folder describes HTTP API behaviour read from the code.
`docs/spec/08_OpenAPI_v1.yaml` is a frozen delivered artefact and must not be edited.

## Why there are two files

The delivered YAML is a scope document wearing an API document's clothes. It names every V1
endpoint, which is genuinely useful — but almost none of them carry a schema. Most operations
declare a bare `200: {description: OK}`, `/auth/login` has no request body at all, and of the
schemas it does define there are exactly three: `SignupRequest`, `ReviewGeneration` and `Error`.
OPEN-04 in `docs/decisions/spec-amendments.md` records the consequence: the pack's own required
"Contract: OpenAPI response validation" test suite cannot be written against it. There is nothing
to validate.

Editing it was not an option — it is part of the frozen contract, and its list of paths is the
agreed V1 surface. So the delivered file keeps its job and this one takes the other: **the frozen
pack remains the contract of record for scope, and `v1.yaml` is the contract of record for
behaviour** where it covers an endpoint.

Everything in `v1.yaml` was read out of `apps/web/app/api/v1/**/route.ts`, not copied across. Every
operation carries `x-implemented-by` naming the handler it describes, so a claim in the YAML can be
checked against code in one step. Field constraints come from the Zod schemas in
`packages/contracts/src`, which are authoritative — where the YAML and a Zod contract disagree,
the YAML is wrong and should be corrected to match.

## What it covers

`v1.yaml` covers sign-up, sign-in, sign-out and password reset; the owner's account; business
identity, links, review destination, slug check and publish; the Ai context and test preview; QR
codes; and the three public customer endpoints (generate, events, feedback).

Not documented yet: the admin console API (`/admin/*`), Google sign-in, MFA and invite acceptance
under `/auth/*`, `/ai/modes`, `/analytics/*`, `/business/billing`, `PATCH` and
`DELETE /business/links/{id}`, `POST /business/links/reorder`, `/customers`, `/feedback`,
`/review-requests`, `/subscription/*` and `/webhooks/razorpay`. These are built and working; they
are simply not in the file.

`x-skeleton-delta` at the foot of `v1.yaml` records where the documented part and the frozen
skeleton diverge: endpoints the skeleton never mentions (for example `POST /auth/reset-password`
and `GET`/`PUT /business/review-destination`, which OPEN-03 in the spec amendments tracks) and
endpoints built with a deliberately different shape. Its statements about what is "unbuilt" date
from when the file was written and are no longer reliable (see
[known gaps](#known-gaps-in-v1yaml-itself)); check [routes](../architecture/routes.md).

## Keeping it in step

There is no tooling enforcing any of this yet, so the discipline is manual. When you add or change a
route handler:

1. Add or update its path in `v1.yaml`, with `x-implemented-by` pointing at the handler file.
2. Reference the Zod contract's shape rather than re-describing it. If a request has no Zod schema,
   that is worth fixing in `packages/contracts` first — a hand-rolled body parse is how the
   `review-destination` `label` field ended up silently ignored.
3. List **every** status the handler can actually reach, not the happy path plus a token `422`. Walk
   the early returns. Put the emitted codes in `x-error-codes` and `Retry-After` on any `429`.
4. Move the operation out of `x-skeleton-delta` when you implement it.
5. Format it. `pnpm format:check` covers this folder, so an unformatted YAML fails CI:
   `node node_modules/prettier/bin/prettier.cjs --write docs/openapi/v1.yaml`.

The gap worth closing next is the one OPEN-04 asks for: a contract test that reads this file,
exercises each documented operation, and asserts the response validates against the declared schema.
That needs an OpenAPI-aware validator in devDependencies. None is installed, and none has been
chosen yet.

`x-error-codes` is an extension rather than a per-response narrowed schema because narrowing means
repeating a four-level-deep `enum` override on about sixty responses, which would bury the document
in boilerplate. A validator can read the extension directly; it is a deliberate trade, not an
omission.

## Known gaps in v1.yaml itself

These statements in `v1.yaml` were true when it was written and are now wrong. Correct them the next
time the file is edited:

- **`dh_anon` "is never minted".** `apps/web/proxy.ts` now sets the anonymous-session cookie; there
  is no `middleware.ts` in Next 16. The `dh_anon` notes on the public endpoints and the cookie
  scheme should say so.
- **`POST /auth/signup` and `POST /ai/test-preview` are "not rate limited".** Both handlers now call
  the rate limiter; limits are in [security](../architecture/security.md).
- **`DELETE /auth/login`** is still described, but the handler was removed in the 24 September 2026
  restructure; `apps/web/app/api/v1/auth/login/route.ts` exports only `POST`. Remove the operation
  and its `x-skeleton-delta` entry.
- **The production server URL** is `review.digitalhammerr.com`; the live host is
  `aireview.digitalhammerr.com`.
- **`x-skeleton-delta` lists built endpoints as not built.** Its
  `implemented-with-a-different-shape` entry says per-section link edit, delete and reorder "are
  not built", and `listed-in-skeleton-not-implemented` lists them too. `PATCH` and
  `DELETE /business/links/{id}` (`apps/web/app/api/v1/business/links/[id]/route.ts`) and
  `POST /business/links/reorder` (`.../links/reorder/route.ts`) now exist; only
  `POST /business/links` does not. The review modes (`/ai/modes`, also described in both places as
  not built), CRM (`/customers`, `/review-requests`), private feedback inbox (`/feedback`) and
  analytics (`/analytics/*`) groups in that list are built as well. Move them out of the delta, and
  document them, when the file is next edited.

## Behaviour worth knowing (still true)

Checked against the code on 24 September 2026. Each is a small correctness question rather than a
contract question, and is documented in the YAML where it affects a caller.

- **Mixed casing in responses.** `GET /business` returns `publishedAt`, `GET /business/links`
  returns `sortOrder`, `GET /ai/context` returns `modes[].isActive` — all Drizzle select aliases
  passed straight through, against snake_case everywhere else including `publicBusinessResponse`'s
  `sort_order`. Documented as-is rather than normalised, because clients already read these shapes.
- **`PUT /business/review-destination` ignores `label`.** It parses `url` off the body itself
  instead of using `reviewDestinationRequest`, so the label is always stored as `Google`.
- **`POST /public/review/generate` does not use `generateReviewRequest`.** It validates its body
  with a local Zod schema and server-validates `selected_services` against the resolved business
  before quota or provider work; omitted selection is allowed only for businesses with no services.
  The local identifier range constraints are broader than the shared contract.
  `POST /public/events` likewise validates with `@ai-review/analytics` rather than
  `publicEventRequest`.
- **`POST /business/publish` can return a non-envelope 500.** If `reserveQrCode` exhausts its five
  collision retries it throws, and the framework's error page is the body — not the `Error` shape
  every other failure returns.
- **`PAYMENT_ALREADY_PROCESSED` is missing from `ERROR_STATUS`** in `apps/web/lib/http/api-error.ts`
  although `docs/spec/23_API_Error_Codes.md` lists it (at `200`, which is itself unusual for that
  table). An unmapped code falls through to `500`, so a handler must not pass that code to
  `apiError`.

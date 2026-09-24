# docs/openapi — the maintained V1 contract

`v1.yaml` in this folder describes the HTTP API that **exists**. `docs/spec/08_OpenAPI_v1.yaml` is a
frozen delivered artefact and must not be edited.

## Why there are two files

The delivered YAML is a scope document wearing an API document's clothes. It names every V1
endpoint, which is genuinely useful — but almost none of them carry a schema. Most operations
declare a bare `200: {description: OK}`, `/auth/login` has no request body at all, and of the schemas
it does define there are exactly three: `SignupRequest`, `ReviewGeneration` and `Error`. OPEN-04 in
`docs/SPEC_AMENDMENTS.md` records the consequence: the pack's own required "Contract: OpenAPI
response validation" test suite cannot be written against it. There is nothing to validate.

Editing it was not an option — it is part of the frozen contract, and its list of paths is the
agreed V1 surface. So the delivered file keeps its job and this one takes the other: **the frozen
pack remains the contract of record for scope, and `v1.yaml` is the contract of record for
behaviour.** Nothing marked not-implemented here has been descoped; it is simply not built yet.

Everything in `v1.yaml` was read out of `apps/web/app/api/v1/**/route.ts`, not copied across. Every
operation carries `x-implemented-by` naming the handler it describes, so a claim in the YAML can be
checked against code in one step. Field constraints come from the Zod schemas in
`packages/contracts/src`, which are authoritative — where the YAML and a Zod contract disagree, the
YAML is wrong and should be corrected to match.

## The delta is the useful part

`x-skeleton-delta` at the foot of `v1.yaml` records where the running system and the frozen document
diverge: seventeen route files, twenty-two operations, against roughly fifty skeleton operations
(the two QR reads landed while this was being written, which is why that group carries a warning).
Three endpoints exist
that the skeleton never mentions (`POST /auth/reset-password`, `GET`/`PUT
/business/review-destination`, `GET /business/slug-available`) — each because an acceptance criterion
was unimplementable without it, which is why OPEN-03 lists the first two. Four more are implemented
with a deliberately different shape, and the rest of V1 — QR management, CRM, analytics, domains,
billing, the whole admin console — is unbuilt.

Read that section before planning work against this API, and before assuming an endpoint in the
skeleton can be called today.

## Keeping it in step

There is no tooling enforcing any of this yet, so the discipline is manual and the file will rot the
day it stops being part of the change. When you add or change a route handler:

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
That needs an OpenAPI-aware validator in devDependencies — nothing suitable is installed. See the
handover note for the named dependency.

`x-error-codes` is an extension rather than a per-response narrowed schema because narrowing means
repeating a four-level-deep `enum` override on about sixty responses, which would bury the document
in boilerplate. A validator can read the extension directly; it is a deliberate trade, not an
omission.

## Discrepancies found while writing this

Documented in the YAML where they affect a caller, and listed here because each is a small
correctness question rather than a contract question. None was fixed — this module owns only these
two files.

- **`dh_anon` is never minted.** `apps/web/lib/customer/anonymous-session.ts` only reads the cookie and names
  `middleware.ts` as the writer, because an RSC cannot set cookies. No `middleware.ts` exists in the
  tree. Until one does, every public request arrives without a session, which silently disables
  public rate limiting on generate and feedback (AC-032), regeneration history for the similarity
  gate (AC-009), and all funnel attribution (AN-01). The handlers degrade rather than fail, so this
  is invisible in testing.
- **`POST /auth/signup` is not rate limited**, while login and forgot-password are. It writes three
  rows and runs an Argon2id hash per call.
- **`POST /ai/test-preview` is not rate limited** either, though its own doc comment says "It is
  therefore rate limited". It calls the provider on every request.
- **`DELETE /auth/login`** clears the cookie without revoking the `sessions` row and without a CSRF
  check (`verifyCsrf` is called in `POST` only). `POST /auth/logout` does both correctly, so this
  method looks like a leftover.
- **Mixed casing in responses.** `GET /business` returns `publishedAt`, `GET /business/links` returns
  `sortOrder`, `GET /ai/context` returns `modes[].isActive` — all Drizzle select aliases passed
  straight through, against snake_case everywhere else including `publicBusinessResponse`'s
  `sort_order`. Documented as-is rather than normalised, because clients already read these shapes.
- **`PUT /business/review-destination` ignores `label`.** It hand-parses `url` off the body instead
  of using `reviewDestinationRequest`, so the label is always stored as `Google`.
- **`POST /public/review/generate` never runs `generateReviewRequest`**, so a body naming neither
  `slug` nor `qr_code` fails resolution and returns `404` rather than `422`. `POST /public/events`
  likewise does not use `publicEventRequest`.
  The generation route now validates its body with a local Zod schema and server-validates
  `selected_services` against the resolved business before quota/provider work. The shared
  contract and YAML describe that field; omitted selection is allowed only for businesses with
  no services. Identifier range constraints in the local route remain broader than the shared
  contract, so the historical identifier discrepancy above is not being claimed as resolved.
- **`POST /business/publish` can return a non-envelope 500.** If `reserveQrCode` exhausts its five
  collision retries it throws, and the framework's error page is the body — not the `Error` shape
  every other failure returns.
- **`PAYMENT_ALREADY_PROCESSED` is missing from `ERROR_STATUS`** in `apps/web/lib/http/api-error.ts`
  although `docs/spec/23_API_Error_Codes.md` lists it (at `200`, which is itself unusual for that
  table). An unmapped code falls through to `500`, so whoever builds the Razorpay webhook needs to
  handle that case explicitly rather than passing the code to `apiError`.

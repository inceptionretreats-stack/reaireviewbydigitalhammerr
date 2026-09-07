# Spec Amendments — V1

Change record required by `00_Master_PRD_AI_Review.docx` §21: _"If there is a conflict, Decision
Log + Master PRD + latest approved change request determine intent; developers must not silently
reinterpret product decisions."_

Every entry below is a **technical** correction. None changes a frozen product decision
(D-001…D-029), the price, the free quota, the no-questionnaire customer flow, or any V1 non-goal.
Where a change touches an ADR it is called out as needing sign-off.

Status legend: **Applied** — in the initial migration / code. **Open** — identified, scheduled.

---

## Schema corrections

All Applied in `packages/db`, migration `0000_initial_schema.sql`.

### AMENDMENT-001 — sessions table added

`06_Database_Schema.sql` defined no session storage, yet SET-01 requires "Log out other sessions",
AC-002 requires session-identifier rotation after login, and `13_Security_Privacy_Compliance.md`
requires rotation on password reset. None is achievable against a stateless token, and Redis alone
would drop sessions on eviction. Sessions are durable rows; Redis is a read-through cache only.
Only the token _hash_ is stored.

### AMENDMENT-002 — password_reset_tokens table added

AUTH-03 requires a single-use, expiring reset token. No table backed it. A `used_at` column
enforces single use.

### AMENDMENT-003 — single owner for the Google review URL

**Conflict.** `06_Database_Schema.sql` placed the URL in `review_destinations` (with an `is_primary`
partial unique index), while `20_Test_Data_Seed.json` seeded GOOGLE_REVIEW as a `business_links`
row carrying its own url. Two writable copies of one URL is exactly how AC-017 — _"changing the
Google review URL immediately changes destination for all existing dynamic QRs"_ — silently
half-works.

**Resolution.** `review_destinations` owns the URL. A GOOGLE_REVIEW row in `business_links` is a
_presentation_ row only: it controls whether and where the Review Us button renders, so the button
still participates in hide/reorder (D-015). Enforced by `ck_google_review_has_no_url`.

**Action required:** `20_Test_Data_Seed.json` still seeds a url on its GOOGLE_REVIEW link and must
be corrected before it is used.

### AMENDMENT-004 — businesses.timezone added

AC-026 requires date filters in the business-local timezone or a documented default, and
`analytics_daily_business.metric_date` is a bare date. Neither the timezone nor the day boundary
existed anywhere. Column added, defaulting to Asia/Kolkata per the same AC.

### AMENDMENT-005 — one slug namespace (business_slugs)

**Conflict.** Live slugs sat on `businesses.slug` and retired ones in `business_slug_aliases`, each
with an independent UNIQUE. Two separate constraints do not compose into one namespace, so a new
business could claim a slug still serving as another business's 180-day redirect
(`04_User_Flows.md` Flow I).

**Resolution.** Both live in one table whose primary key _is_ the namespace. This also collapses
public slug resolution into a single indexed lookup answering "which business, and is this a
redirect?" — which is what PUB-01 needs anyway.

### AMENDMENT-006 — payments.status is an enum

Was a bare varchar(40) where every comparable field in the schema is an enum.

### AMENDMENT-007 — super-admin MFA storage added

`13_Security_Privacy_Compliance.md` and `19_Admin_Panel_Spec.md` both make MFA **mandatory** for
super-admin, but `users` carried no columns for it. Storage defined now; the enrolment and challenge
flow is built in E13.

### AMENDMENT-008 — user_invites table added

`04_User_Flows.md` Flow B step 2 requires a secure invite / set-password link for Digital
Hammerr-assisted account creation. No table backed it. Storage now; flow in E12.

### AMENDMENT-009 — businesses.description narrowed to 500

Schema said varchar(1000); ONB-01 specifies a 0-500 short description.

### AMENDMENT-010 — prompt version rollout rule stated

ADMIN-03-01 requires "only one default active production version", but `ai_prompt_versions` also
carries `rollout_percent` with no rule for what serves the remainder at, say, 50%. Resolution: at
most one ACTIVE row is the default (now enforced by a partial unique index); a partial rollout
splits against the most recently archived version as control.

### AMENDMENT-011 — custom_domains hostname lockout fixed

**Bug.** A plain global UNIQUE on hostname, combined with a REMOVED status that retains the row,
permanently burns the hostname: once a business removes review.example.com, no tenant can ever
claim it again — including the original owner re-adding it. AC-027 actually asks only that a
hostname not be claimable by a second tenant _while live_. Replaced with a partial unique index
excluding REMOVED.

### AMENDMENT-012 — analytics_events partitioned monthly

At the modelled scale this table reaches roughly **300M rows and 100-150 GB**, and
`13_Security_Privacy_Compliance.md` sets 13-month retention on it. Enforcing that by DELETE at that
size is a maintenance incident; dropping a partition is instant. Partitioning is free at CREATE
TABLE and expensive to retrofit.

Two consequences, both applied: Postgres requires the partition key in every unique constraint, so
the primary key is (id, occurred_at) rather than id, and event-id uniqueness becomes
(event_id, occurred_at). A DEFAULT partition exists purely so an unexpected timestamp can never
fail an insert and break the customer flow (AC-035); the worker pre-creates partitions so it stays
empty.

### AMENDMENT-013 — business_links.link_type is an enum

Was varchar(40). `19_Admin_Panel_Spec.md` lists "Allowed profile section types" as platform
configuration, which presumes the set is closed. Also adds `ck_enabled_link_has_target`, making
PROFILE-01-02 ("blank URL cannot be enabled") a database constraint rather than a convention.

### AMENDMENT-014 — regeneration similarity threshold recalibrated to 0.45

`09_AI_Prompt_and_Generation_Spec.md` recommends 0.82, describing it as "normalized
semantic/text similarity". 0.82 is a reasonable cut for _embedding cosine_ similarity. The V1
gate uses character-trigram Jaccard — deterministic, free, and no extra provider call — which
is a different scale.

Measured against a representative 100-character draft:

| Change             | Score |
| ------------------ | ----- |
| identical          | 1.000 |
| punctuation only   | 1.000 |
| clauses reordered  | 0.968 |
| one word swapped   | 0.818 |
| two words swapped  | 0.702 |
| four words swapped | 0.319 |
| different topic    | 0.112 |
| genuine rewrite    | 0.070 |

At 0.82 a two-word synonym swap scores 0.702 and passes — precisely what AC-009 forbids when it
says a regeneration must not "simply synonym-swap". The distribution is strongly bimodal with
nothing between 0.32 and 0.70, so the cut is not delicate; **0.45** sits mid-gap.

The calibration table is pinned by test, so changing the metric without re-calibrating fails CI
rather than silently loosening how strict regeneration is.

---

## Behaviour corrections

### AMENDMENT-015 — changing the account email clears `users.email_verified_at`

`PATCH /api/v1/account` (SET-01) sets `email_verified_at` to NULL whenever the address actually
changes. The column is a claim that _that_ address was proved to belong to the account holder, and
the new one has been proved by nobody; carrying the timestamp across would mark an unproven address
verified, and anything later gated on verification — Flow B invites, notifications, a recovery
check — would then trust it.

Nothing in `apps/` or `packages/` reads the column today, so the downgrade changes no behaviour in
V1. It is recorded because it is one-way: V1 has no re-verification flow, so for the accounts that
have it set — seeded and admin-created users — the timestamp cannot come back. The endpoint reports
`email_verification_cleared` and the settings screen turns it into a sentence, so the loss is
stated rather than silent. See OPEN-07.

### AMENDMENT-016 — POST /account/password answers 200 when its post-commit session work fails

The password UPDATE commits before the endpoint sweeps other sessions and rotates the caller's own
identifier. If that post-commit work throws, the credential has already been replaced, so a 500
would tell the owner the change failed while their new password is the one that works — and they
would then try the old one at `/login` and be refused. The endpoint returns 200 with
`sessions_swept: false` and `other_sessions_signed_out: 0` instead, and the screen says the other
sessions may still be signed in and points at "Log out other sessions". SET-01-02 is unaffected: the
sweep is still attempted on every change, and the failure is reported rather than assumed.

---

### AMENDMENT-017 — `/` is a product landing page; the spec names no screen for it

`03_Screen_Field_Button_Spec.md` covers every authenticated screen and both public tenant surfaces
(`/{slug}` and `/r/{code}`), but nothing for the root of `review.digitalhammerr.com`. It cannot stay
empty: it is where a business owner arrives from a search, a card or a word of mouth, and the only
page that has to explain the product rather than perform it.

The page states what the product does, how the customer's three steps run, what it costs, and —
given equal weight — the four things it will not do: post on a customer's behalf, ask for a star
rating, claim a review was submitted, or oblige a customer to keep the merchant's terms. Those are
D-028, D-009, AC-025 and D-025 restated as a promise to the reader rather than as internal rules.

The page is public HTML, so `e2e/landing.spec.ts` extends the AC-006 sweep to it. A marketing page
is the likeliest place for a decorative row of stars to appear the first time someone is asked to
make the product look friendlier, and that would be a rating control on the public surface however
it was intended.

Outside production the page also renders the seeded tenant's real QR and links into the running
flows, which is development scaffolding rather than a product decision: the block is absent when
`NODE_ENV` is production or the seed has not been run.

---

### AMENDMENT-018 — the owner's screens show the QR, and the dashboard names the step after publish

Two gaps found by walking a new tenant through signup, setup, publish and the dashboard.

**The QR was invisible to the owner.** ONB-05 and QR-01 both specify download actions and neither
specifies an image, so the product shipped with the artefact it exists to produce visible nowhere
in the owner's interface: the finish screen offered SVG and PNG buttons, and QR-01 listed sources as
a table of labels, codes and URLs. An owner could not see what they were about to print, and an
owner with several standees could not tell which row was which without downloading each one.

Both screens now render the symbol. `apps/web/lib/qr-image.ts` holds the one encoder configuration
and the download endpoint uses it too, so a preview and a printed file cannot drift into being
different codes — a failure that would otherwise surface after a print run rather than on screen.
The row carries the image as a data URI (`preview_src`, added to `QrSource` in the OpenAPI) rather
than a link to `GET /qr/{id}/download`, because that endpoint answers with an attachment
disposition on purpose: an SVG served inline from our own origin is a script execution context.

**Publish is where a self-service setup stops helping.** Everything turns green, and the owner is
left holding a working product no customer has met, because the one remaining task — print the code
and put it where people pay — happens away from the screen. DASH-01 specifies KPI cards and a
funnel, all of which read zero at that moment.

The dashboard now shows a first-steps card between publishing and the first scan: print it, scan it
yourself off the print, then leave it alone. It is the counterpart to the existing setup-progress
card on the other side of publish, and like that card it is transient — the first `qr_scan` retires
it, so it is guidance rather than furniture and nobody has to dismiss anything. `qr_scan` is the
signal because it is the one thing configuration cannot imply: a business can be perfectly set up
with its standees still in a drawer.

The card deliberately offers no link to the review page. Following one from the dashboard would
record a scan against a source the owner is only inspecting, inflating the attribution QR-01-03
exists to make readable — the same reason QR-01 prints the resolve URL as text. Testing is done with
a phone on the printed artwork, which is also the only way to catch the failure that matters: a code
that will not scan off paper.

---

## Architecture amendments — require product-owner sign-off

### ADR-AMEND-A — no separate NestJS service

`02_System_Architecture.md` specifies NestJS/Fastify as a second container. Modelled load is ~3
req/s average and ~40 req/s peak, which is one container's work. The API is served by Next.js route
handlers; domain logic lives in `packages/core`, framework-free, imported by both web and worker.

The secret-isolation boundary in `16_Repository_Folder_Structure.md` is preserved and arguably
strengthened — it becomes a framework-enforced server/client split rather than a network hop.
Extraction into a standalone service later is mechanical.

_No Decision Log entry names NestJS; D-001 through D-029 are all product decisions._

### ADR-AMEND-B — launch hosting is DigitalOcean BLR1; AWS Mumbai remains the destination

ADR-010's reasoning — proximity to the Indian market, mature managed services — is satisfied by
Bangalore. What differs is fixed cost: a Fargate footprint needs an ALB and NAT Gateway before a
single container runs, against under ₹50,000 of annual revenue at 50 tenants. Same three service
boundaries, so the eventual move is a redeploy plus dump/restore. Terraform in `infra/` targets AWS.

**Migration trigger:** `analytics_events` past ~50 GB, monthly infrastructure past ~₹15,000, or
procurement/compliance requiring it.

### ADR-AMEND-C — PostgreSQL 17+ acceptable

The pack mandates 18.x. The schema uses only gen_random_uuid(), citext, bigserial, partial unique
indexes, jsonb, enums, timestamptz, CHECK constraints and fixed-width char — all long established.
Managed providers routinely lag a major version; requiring 18 would narrow vendor choice for no
functional gain.

---

## Open — identified, not yet addressed

| ID          | Item                                                                                                                                                                                                                                                                                                                                                                                                                                        | Epic    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| OPEN-01     | Quota concurrency: consume via an atomic conditional UPDATE with a `free_generations_used < free_generation_limit` guard and RETURNING, never read-modify-write. AC-013 fails otherwise. Compensate on provider failure for AC-014.                                                                                                                                                                                                         | Phase 4 |
| OPEN-02     | No endpoint resolves `review_requests.tracking_token_hash`. The column and the `review_request_link_click` event both exist, but nothing consumes the token, so Flow F step 9 attribution cannot work.                                                                                                                                                                                                                                      | E7      |
| OPEN-03     | Missing endpoints: PATCH/DELETE `/business/review-destinations/{id}` (the Google URL can be created but not edited, yet AC-017 requires changing it); POST `/auth/reset-password`; GET `/admin/audit-logs`; checkout signature verification, which AC-015/016 require server-side where only the webhook exists.                                                                                                                            | various |
| OPEN-04     | `08_OpenAPI_v1.yaml` is a skeleton: most endpoints declare a bare 200 with no schema, and `/auth/login` has no request body at all. Only SignupRequest, ReviewGeneration and Error are defined. The pack's own required "Contract: OpenAPI response validation" suite is not achievable against it. Complete per endpoint as each is built.                                                                                                 | ongoing |
| ~~OPEN-05~~ | **Resolved.** Both models exist and pricing is verified. Luna lands at ~4.6% of revenue at scale, so the 999 rupee price point holds comfortably. See AI unit economics below.                                                                                                                                                                                                                                                              | Phase 0 |
| OPEN-06     | `17_Backlog_Epics_User_Stories.md` is 88 stories of identical placeholder text — an epic index, not a backlog. Treat `12_QA_Acceptance_Criteria.md` as the acceptance source of truth and use file 17 only for epic and story IDs.                                                                                                                                                                                                          | product |
| OPEN-07     | No email verification, and the address is the sign-in identity. `PATCH /api/v1/account` accepts a new address with no confirmation mail, so a typo silently becomes the login identity and AUTH-03 forgot-password then mails an inbox nobody holds — recovery is a support call. An address change also does not sweep other sessions (a password change does). AMENDMENT-015 records the `email_verified_at` downgrade that goes with it. | E13     |

---

## Implementation notes

Not spec changes; recorded so the choices are traceable.

- **TypeScript pinned to 6.0.3.** TypeScript 7.0 (the native port) typechecks this codebase
  correctly, but typescript-eslint 8.68.0 declares support for `typescript >=4.8.4 <6.1.0` and
  refuses to load against the TS 7 API. Revisit when typescript-eslint supports it.
- **AC-025 is enforced by lint, not review.** `eslint.config.mjs` fails the build on any string,
  template literal or JSX text matching "review submitted". The taxonomy test additionally asserts
  that no event name implies submission and no event property carries a star rating — the latter
  because D-009 means the customer is never asked for one.
- **Analytics types are generated from the CSV.** `11_Analytics_Event_Taxonomy.csv` stays the
  contract; `packages/analytics/src/events.generated.ts` is derived from it, and CI regenerates and
  fails on any diff. This is what makes AN-01-01 structural.

---

## AI unit economics — verified

Resolves OPEN-05. Verified against the OpenAI model catalogue, August 2026. Recheck before
procurement, as PRD §24 requires.

Both models named in `15_Environment_Variables.example` and ADR-007 exist:

| Model           | Input            | Output            |
| --------------- | ---------------- | ----------------- |
| `gpt-5.6-luna`  | $0.20 / M tokens | $1.20 / M tokens  |
| `gpt-5.6-terra` | $2.00 / M tokens | $12.00 / M tokens |

**Per generation.** Roughly 500 input tokens (system prompt, business context, and up to three
previous drafts on a regeneration) and ~120 output tokens against the 220-token cap in
`10_AI_Prompt_Templates.json`. That is about **$0.00024 per generation**, a blended ~$0.39/M.

**At scale.** ~60,000 generations/day is ~$440/month, or ~$5,300/year, against roughly ₹1 crore of
annual revenue at 10,000 paid tenants. **AI is about 4.6% of revenue.** The ₹999 price point holds
comfortably, and the 220-token output cap is doing real work — output is 5x the price of input.

Free-tier exposure is negligible: 10 generations per free business is about $0.0024, so even
10,000 never-converting free businesses cost roughly $24 in total.

### Guardrail — Terra must never be an automatic failover

Terra is 10x Luna. At full volume it would run ~$4,300/month, or roughly **45% of revenue** — the
business does not work on it. ADR-007 already scopes Terra to a canary and quality comparison, and
that scoping is financial, not just architectural.

This aligns with what `02_System_Architecture.md` already specifies for an AI outage: _"show a
friendly retry state; never block the business profile or direct Google button."_ Degrading to the
retry state is both the specified behaviour and the correct commercial one. **Do not implement an
automatic full-traffic failover from Luna to Terra.** Any Terra routing must be an explicit,
percentage-capped rollout under `ai_prompt_versions.rollout_percent`, with per-tenant AI spend
alerting live before it is enabled (`14_DevOps_Deployment_Runbook.md` cost controls).

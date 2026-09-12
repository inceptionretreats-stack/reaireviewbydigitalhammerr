# Spec Amendments — V1

Change record required by `00_Master_PRD_AI_Review.docx` §21: _"If there is a conflict, Decision
Log + Master PRD + latest approved change request determine intent; developers must not silently
reinterpret product decisions."_

Entries under **Approved product changes** record an explicit change request. The remaining
entries are **technical** corrections and do not change a frozen product decision. Where a change
touches an ADR it is called out as needing sign-off.

Status legend: **Applied** — in the initial migration / code. **Open** — identified, scheduled.

---

## Approved product changes

### CHANGE-001 — Pro is capped at 2,000 AI review drafts per subscription year

**Approved:** 10 September 2026. **Applied:** migrations `0002_pro_annual_quota.sql` and
`0003_pro_quota_period_reset.sql`, plus the public generation quota service.

This supersedes D-006's fair-use-unlimited wording. Pro remains the only paid plan at INR 999/year
and still includes every V1 feature, but it now permits at most 2,000 successful public AI review
drafts during each paid subscription year. Owner test previews do not count. Provider failures
release a reservation, customer regenerations do count, and the direct Google link remains
available after the allowance is exhausted. Short-window abuse monitoring remains separate from
the annual cap.

The product calls these **AI review drafts**, not submitted reviews, because the application cannot
verify a submission on Google (D-028).

### CHANGE-002 — User-facing acronym casing is `Ai`

**Approved:** 10 September 2026. **Applied:** website copy, page metadata, accessibility labels,
transactional email subjects, and generated customer-facing artwork.

The displayed product name is **Ai Review by Digital Hammerr**. In all user-facing prose the
acronym is written `Ai`, including phrases such as `Ai review draft` and `Ai assistance`. Technical
identifiers remain conventional and stable: API error codes such as `AI_PROVIDER_UNAVAILABLE`,
environment variables, database enum values, route paths, source filenames, and third-party names
such as OpenAI are not renamed.

### CHANGE-003 — Draft language is a per-business setting, and the default is Hinglish

**Approved:** 11 September 2026. **Applied:** migration `0004_draft_language.sql`, prompt version
`1.1.0`, the onboarding Ai step and the Ai Review settings screen, the generator and its
compliance gates, the stub provider.

This supersedes D-011 ("English only in V1") and the word "English" in AC-007, in
09_AI_Prompt_and_Generation_Spec.md's purpose and global-prompt rule 2, and in README_FIRST's frozen
decisions. Each business now has a **draft language**, `en` or `hinglish`, stored on
`ai_business_contexts.draft_language`. The default — for a new business, and for every existing
one at migration time — is `hinglish`: everyday spoken Hindi written in Roman script, naturally
mixed with English, the way people in India write Google reviews. The owner sets it on ONB-04 and
on AI-01, which gain one field beyond 03_Screen_Field_Button_Spec's list. Dashboard and customer-
page chrome stay in English; only the draft changes. "Additional languages" remains Phase 2 —
this pulls forward exactly one.

**Why it is not a review-mode property.** A mode is context emphasis and nothing else (D-025), and
the modes contract test pins that no other field exists. Language is part of _how the Ai writes for
this business_, alongside the summary and context terms, and lives with them.

**How it reaches the model.** `GenerationRequest.draftLanguage` is required. `buildPrompt` writes a
`DRAFT_LANGUAGE=` line and a code-owned `LANGUAGE_RULES` block into the user message; the rules
carry one register example marked as tone-only, because an unmarked example becomes every first
draft's opening. The stored 1.0.0 system prompt says "English draft" and is seeded verbatim from a
frozen file, so a user-message line alone would be arguing with the system prompt. Prompt version
**1.1.0** therefore lives in `scripts/prompt-versions/1.1.0.json` — 1.0.0 with exactly one sentence
changed, pinned byte-for-byte otherwise by the seed test — and the seed activates it and archives
1.0.0 rather than editing it. `max_output_tokens` is **320** on 1.1.0, not 220: Roman-script Hindi
tokenises worse than English, and a draft cut off at the cap is a non-retryable failure, not a
shorter draft. The cap bounds the worst case; billing is on actual tokens.

**The gates learn Roman Hindi.** The four compliance families were English vocabulary. Each now also
matches the form the same claim takes in a Hinglish draft — `paanch star`, `5 sitare`, `muft mein`,
`ke badle mein`, `10 minute mein`, `do ghante ke andar`, `2000 rupaye`, `40% sasta`,
`sabse accha`, `behtareen` — while ordinary praise (`bahut accha tha`) passes. The length gate is
character-based and unchanged. The similarity threshold stays at 0.45 pending measurement with a
real model: Hinglish's small set of function words (_tha, hai, aur, bhi_) may inflate trigram
overlap between genuinely different drafts, and `similarityThreshold` already exists on the
generator for a per-language value if the numbers say so.

**The stub follows the setting.** `StubAiProvider` carries a Hinglish pool and selects it when the
prompt's `DRAFT_LANGUAGE` line says so, so the no-key demo and the E2E suite show the language the
setting claims. The unit suite pins the pool: eight drafts, every gate passed, no digit or "star",
every pair below the similarity threshold.

**Follow-up, not built here.** The seed refuses to run in production, so activating 1.1.0 there
needs ADMIN-03 or a prompt-only script; `pnpm ai:model` changes the model of whichever row is
ACTIVE but not the prompt text.

**Measured, 11 September 2026, `gemini-3.5-flash-lite` at thinking `minimal`.** Thirty owner
previews and two real customer sessions of five drafts each (ten public generations), all through
the public tunnel:

- Gates: 40 of 40 drafts passed on the first attempt. No `TOO_SIMILAR`, no praise, incentive or
  claim rejection. The similarity threshold stays at 0.45: regenerations scored 0.25–0.40 against
  the drafts they were compared with, all first-attempt accepts.
- Tokens: 560–830 in, 143–192 out including thoughts; the 320 cap was never approached.
  Latency: median 1.7 s, maximum 1.9 s, against an 8 s budget.
- What the gates could not see, and the prompt now says: seven of the first ten previews opened
  with the identical sentence (_"Main kal hi … gaya tha aur wahan ka khana mujhe kaafi pasand
  aaya"_), and _kal_ — yesterday — is an invented date. `buildPrompt` now emits an OPENING hint
  rotated by a per-session seed (`variationSeed`: the anonymous session in the customer flow, a
  fresh id per preview), forbids opening with the business name or with _Main_/_I_, and forbids any
  statement of when the visit was. After that, three of ten drafts said _"service thodi slow thi"_
  and six said _"time par mil gayi"_ — timing claims with no number in them, so no regex matches,
  and the customer made neither. A CLAIM_RULES block, in both languages, now forbids any statement
  about speed, waiting or timing and any complaint added for balance. The following ten drafts had
  ten different openings and no timing or date claims.

### CHANGE-004 — Nothing per business by hand: admin panel, writing rules as data, Razorpay

**Approved:** 11 September 2026 (product owner: "instead of hardcode do work in a proper manner",
choosing all three of admin activation, self-serve Razorpay and rules-as-data, with the free
allowance kept at 10). **Applied:** migration `0005_entitlement_source_and_guidance.sql`, the
`(admin)` route group and its five screens, `SubscriptionService`, `PlatformSettingsService`,
`PromptVersionService`, `CheckoutService`, the Razorpay client, SUB-01, and `pnpm admin:create`.

Until this change the only way a business moved from Free to Pro was an operator typing an
`UPDATE subscriptions` into psql — which is how the first pilot tenant was activated — and the
Ai writing rules were constants in `prompt-builder.ts`. Both were "hardcoded" in the sense that
matters at a hundred tenants: changing them for the hundredth one meant a developer. The spec
already named the mechanisms (E12 admin panel, ADMIN-03 versioned prompts under ADR-006, E10
Razorpay); this change builds the subset each needs and records what differs from the frozen text.

**Entitlement has exactly one writer.** `SubscriptionService.activatePro(businessId, input)` is
the only code that puts a row on `PRO_ACTIVE`, and `input.source` is `'ADMIN'` (actor, reason,
optional note and months) or `'PAYMENT'` (the `payments.id` that earned it). Both land on the
same UPDATE, so the invariants hold for both: a paid status always carries a period
(`ck_paid_status_has_period`), a new `starts_at` resets the annual counter (migration 0003's
trigger), and a renewal — paid early or granted early — starts where the current period ends
rather than from today, so time already owned is never lost. New columns on `subscriptions`:
`entitlement_source` (`NONE | PAYMENT | ADMIN`), `entitlement_granted_by` (FK users, ON DELETE
SET NULL — the audit log is the permanent record, and an admin account leaving must not pin every
row it touched), `entitlement_note`. The dashboard and the admin list show an admin grant as
"Pro — granted by admin", which 19_Admin_Panel_Spec asks for. `revokePro` sets `CANCELLED`, not
`FREE`, so the history of having paid survives. Every admin mutation is written by `AuditWriter`
inside the same transaction, with before/after state, and the writer refuses a high-risk action
without a reason (RBAC rule 5) — the contract refuses it too, so the operator is told before typing
everything else.

**Admin panel — E12 subset built: ADMIN-01, 02, 04 and ADMIN-03.** `/admin` (KPIs),
`/admin/businesses` (search, Free/Pro, status, expiring), `/admin/businesses/[id]` (subscription
actions and the audit trail), `/admin/settings` (platform settings, versioned), `/admin/audit`,
`/admin/ai` and `/admin/ai/[id]`. Guarded by `requireAdmin` — CSRF, session, `SUPER_ADMIN` —
in a separate route group with its own layout (RBAC rule 4); `landingPathFor` already sent admins
to `/admin`. **MFA is not built.** `19_Admin_Panel_Spec.md` makes it mandatory and it is E13;
until then no admin account may exist on a publicly reachable deployment. `create-admin.mjs`
refuses to run in production for that reason. The seed keeps an existing admin's password on a
reseed unless `SEED_ADMIN_PASSWORD` is set, because a reseed that silently locked the operator out
is what happened the first time.

**Platform settings are data.** `platform_settings` holds `free_generation_limit` (10),
`annual_price_paise` (99,900), `pro_generation_limit` (2,000) and `fair_use_monthly_soft_limit`
(null), each versioned and audited on change; signup reads the free limit when it creates the
subscription row, and checkout reads the price. The env bootstrap values remain only as defaults
for an unseeded database. Only changed keys are written, so a form that re-sends every value does
not inflate versions.

**Writing rules are data (ADMIN-03 / ADR-006 / E4-08).** `ai_prompt_versions.guidance` (jsonb)
carries `language_rules.{en,hinglish}`, `claim_rules`, `emoji_rules`, `opening_hints` and
`emoji_placements`. `buildPrompt` keeps only the mechanism — the `DRAFT_LANGUAGE` line, the
seed-rotated choice of opening and emoji placement, the rejection guidance — and reads every rule
from the active version. `DEFAULT_GUIDANCE` in core is what the constants were, used by the seed
to fill 1.1.0 and by the unit tests. Versions move DRAFT → ACTIVE → ARCHIVED with one ACTIVE at a
time; activating an archived version is the rollback, and activating anything is audited. Proved
through the tunnel: a rule edited on `/admin/ai`, activated, and obeyed by Gemini on the next
public generation with no restart; then rolled back. A version that has written drafts is
read-only — "New draft from this version" is the way to change it.

**Razorpay (E10-02, E10-03, E10-04, E10-06).** `packages/core/src/billing/razorpay.ts` is a
fetch-based Orders API client plus two timing-safe HMAC-SHA256 verifiers: the checkout signature
over `order_id|payment_id` with the key secret, and the webhook signature over the raw body with
the webhook secret. `CheckoutService` has three entry points and one outcome: `startCheckout`
(order for `annual_price_paise`, `payments` row CREATED), `completeCheckout` (the browser
callback; signature, then the order must belong to the calling business) and `handleWebhook`
(signature over the raw bytes, then a ledger row in `payment_webhook_events` keyed on
`X-Razorpay-Event-Id`). Both of the last two land in one private `settle`, which locks the
payment row, returns without activating if it is already CAPTURED, and otherwise marks it
CAPTURED and calls `activatePro({ source: 'PAYMENT' })` in the same transaction. That is what
AC-015's "idempotent" means here: whichever of the callback and the webhook arrives first
activates the year; the other, and any redelivery, activates nothing. Two refinements found by
running it: the subscription status is never set to `CHECKOUT_PENDING` during checkout, because a
business renewing early is still on Pro while it pays and that status would have taken it away;
and a webhook delivery that failed part-way is processed again on redelivery — only a delivery
that finished cleanly is a duplicate — so Razorpay's retries recover a lost event instead of
colliding with its ledger row. A permanent failure (an order this platform never created, an
amount that does not match) is recorded on the ledger row and acknowledged with 200, so Razorpay
stops retrying something that will never succeed; a transient one is a 5xx so it does retry.
The period a payment bought is written onto the payment's `raw_reference`, so last year's receipt
still says what last year's payment covered.

**SUB-01 as built.** `/app/subscription` shows plan, source, start, expiry with days left, usage
for the counter in force, the Pro allowance, and payment history with a receipt per captured
payment (`/app/subscription/receipts/[id]`, tenant-scoped, print-to-PDF — no PDF library and no
file the server keeps). The five states from the screen spec are the plan status plus the
purchase phase: free and expired offer "Upgrade — ₹999/year"; paid offers "Renew" only inside the
last 30 days of the year and otherwise says when renewal opens; checkout is the Razorpay sheet
open or the signature being verified; payment failed is a declined card, a closed sheet, or a
verification the server refused. Checkout.js is injected on click, never on page load; the only
thing it receives is what `/subscription/checkout` returned, and the page believes the server's
answer to `/subscription/verify`, not Razorpay's. Without Razorpay keys the button stays — the
owner should not have to guess whether Pro exists — and pressing it says that online payment is
not set up and Digital Hammerr can activate Pro; the route answers `PAYMENTS_NOT_CONFIGURED`
(503), a code added to 23_API_Error_Codes.md's list by this change. Online payment is therefore
optional in production, on purpose. The dashboard card links here instead of saying the flow does
not exist. The Subscription nav item is live.

**What OPEN-03 loses.** Checkout signature verification (`POST /subscription/verify`) and
`GET /admin/audit-logs` now exist; the review-destination edit path and `POST /auth/reset-password`
were already built. OPEN-03 keeps only the collection-form review-destination routes.

**Verified, 12 September 2026.** Against the real schema: eight `CheckoutService` integration
tests (start; callback then webhook then redelivery activates once and the expiry does not move;
webhook alone activates; forged, foreign and unknown callbacks refused with the plan untouched;
bad signature and wrong amount; `payment.failed` and an ignored event; redelivery after a failed
first delivery; renewal from the current expiry). Over HTTP against the running server with
rehearsal keys and a fake Orders endpoint (`RAZORPAY_BASE_URL`): 201 order, forged callback 400
and still Free, genuine callback activated, forged webhook 400, real webhook processed without a
second activation, redelivery duplicate, receipt 200 and a foreign receipt id 404, both analytics
events recorded. In Chrome through the public tunnel: Checkout.js not loaded until the click, then
loaded and the Razorpay sheet opened for the order. Playwright, unconfigured: six SUB-01 tests
(free, dashboard link, paid inside the window with receipt, paid outside it, expired, forged
verify and webhook activate nothing). Six admin E2E tests from Stage A/B stand.

**Not built.** Razorpay Subscriptions (recurring; `RAZORPAY_ANNUAL_PLAN_ID` stays unused — V1 is a
one-time yearly order, which is what D-022's "one-time payment" allows), refunds, GST invoices,
Custom Domain, MFA.

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

### AMENDMENT-019 — Anthropic is a supported provider, and the seeded model is configurable

ADR-007 names OpenAI and two models, `gpt-5.6-luna` and `gpt-5.6-terra`.

> **Correction, 11 September 2026.** This amendment originally called both models "spec fiction".
> They are real: verified against OpenAI's live model catalogue and pricing page — Luna at
> $0.20 / $1.20 per million tokens, Terra at $2.00 / $12.00, both accepting `reasoning.effort:
"none"`. The "AI unit economics — verified" section further down had it right all along. The
> seeded default is Luna again (CHANGE-003 ships prompt version 1.1.0 on it); the Haiku figures
> below stay as the comparison they were. The provider mechanism this amendment introduced is
> unchanged.

`AnthropicProvider` now sits beside `OpenAiProvider` behind the same `AiProvider` interface, and
`selectProvider` maps keys to providers: Anthropic when `ANTHROPIC_API_KEY` is set, OpenAI when
only `OPENAI_API_KEY` is, the stub when neither. Anthropic wins when both are present — a stated
precedence, so the active vendor is a property of configuration rather than of declaration order.
Production requires one of the two rather than a named one; what must never happen is a live
tenant being served stub drafts, not that a particular vendor is configured.

`docs/spec/10_AI_Prompt_Templates.json` is frozen, so the model cannot be corrected there. The
seed takes `AI_DEFAULT_MODEL` in preference to the template's `default_model`, and
`scripts/set-ai-model.mjs` changes the ACTIVE version's model on a running system. That script is
also the first delivery of the rollback ADR-006 promises: until now the only writer of that table
was a seed script reading a frozen file, so "roll back without a deploy" was not available to
anyone.

Reasoning effort is now overridable and may be empty. It was `notNull().default('none')` with a
`min(1)` seed validator, so an environment could not express "this model takes no effort field" —
and sending one to a model that does not accept it is a 400 on every request. The Anthropic
adapter ignores the field outright, since that API has no equivalent.

**Model choice is a commercial decision.** The unit economics assume ~$0.20/$1.20 per MTok. At
~270 generations per business per month, Claude Haiku 4.5 costs roughly ₹310/year per business
against ₹999 revenue (~31%); Sonnet 5 is ~62% and Opus 5 exceeds the subscription outright. Haiku
4.5 is seeded as the default for that reason and is one command to change.

### AMENDMENT-020 — a printed QR is only as good as the address it encodes

Twelve of the thirteen places that mint a QR encode `APP_BASE_URL`. Every automated gate passed
with that set to `http://localhost:3000`, because the suite drives localhost from the same
machine — the one context in which the fault is invisible. Scanned from a phone, `localhost` is
the phone, and the scan resolves to nothing.

Two changes follow. `scripts/tunnel.mjs` puts the dev server behind a public HTTPS URL and writes
it to `APP_BASE_URL`, which fixes every QR producer and the CSRF origin allowlist in one move;
`allowedDevOrigins` is derived from the same value so Next's dev endpoints are not blocked at the
new host. And `e2e/business-onboarding.spec.ts` now asserts the minted `resolve_url` equals
`${APP_BASE_URL}/r/{code}` — compared against the configured value, never a literal, because a
literal would have passed while the product was broken.

The demo credentials on the landing page are now shown only to a visitor on loopback. They were
printed to every visitor, which was harmless on a laptop and hands the demo owner's dashboard to
anyone with the link the moment the server is public.

### AMENDMENT-021 — the similarity gate judges only what the prompt disclosed

`buildPrompt` shows the model the last three drafts; the gate compared a candidate against every
draft in the session. A long session therefore rejected a draft for resembling something the model
had no way to know about, retried into the same wall, and returned `AI_OUTPUT_REJECTED`
permanently — the anonymous cookie lives thirty days, so "the AI stopped working" was accurate and
irreversible for that visitor.

Both now use `MAX_PREVIOUS_DRAFTS`. Alongside it: the internal retry limit rises from two to three
and each retry now carries _why_ the last attempt was rejected, so the model corrects rather than
resamples blind. That matters more with a real model than with the stub — the compliance gates
reject the bare word "perfect" and any currency amount, which real review prose produces readily,
and every rejection was a 503 in front of a customer standing at a counter.

`StubAiProvider` derives its draft from the request rather than an instance counter. The route
builds a fresh provider per request, so anything a provider remembers between calls is a fiction
in production; the counter restarted at zero every time while the gate compared against persisted
drafts. That mismatch is what made the third generation in a session fail every time.

---

### AMENDMENT-022 — the draft is written on arrival, and copy-and-continue is one action

REV-01 specifies a "Generate My Review" action on the review landing page, and REV-03 a separate
continue-to-Google step that appears after copying. Watching the flow, both are steps that ask
nothing and decide nothing:

- A scan is already an intent to write a review. Making the customer tap _Generate_ is asking them
  to confirm something they have just done with their phone camera.
- Copying and then having to find a second button left people holding copied text on a page that
  looked finished. The most common way to lose someone is to make them do one more thing after
  they have decided.

So the page generates on arrival, and the review controls are two: **New review** and **Copy &
open {platform}**. The second copies to the clipboard and navigates in the same action.

**The confirmation gate is unchanged.** It is a tick, not a tap, so simplifying to two buttons
does not touch it, and it is the control that separates a writing assistant from a review
generator (ADR-008, AC-008). Copy is a genuinely disabled `<button>` until the box is ticked and
only then becomes an `<a>` — not a link styled to look disabled, which would still follow on a
click or an Enter key. Regenerating still clears it, because a new draft is text the customer has
not read.

The copy control is an anchor rather than a button calling `window.open`. A popup opened after an
awaited clipboard write has lost its user activation and browsers block it; a real link in a new
tab never is. `rel="noopener"` so the destination cannot reach back through `window.opener`.

**When there is no clipboard.** `navigator.clipboard` exists only on a secure origin, so on a
plain-HTTP address (a LAN dev server) it is absent before the tap does anything. That case is
detected first and the tap is kept on the page: the draft is selected for the device's own Copy
command, the failure is stated, and the destination is offered as a plain link for afterwards.
A write that is _attempted_ and then refused — a permissions prompt declined on HTTPS — is
reported the same way on this page, which stays open behind the new tab. "Copied" is shown only
after the write has resolved. This is a technical note on the one-action design, not a change to
it: an earlier implementation split copy and open back into two steps to work around the
insecure-origin case, which traded the approved flow for a dev-environment problem.

**Generating on arrival makes a page load billable**, which on the free plan matters: ten
generations is the lifetime allowance, so ten curious refreshes would spend it before anyone
posted anything. The server therefore hands the client the session's most recent draft when one
exists (`loadLatestDraft`), and generation only runs when there is nothing to show. That is also
what a customer expects — returning to the page should show the review they were part-way through
editing, not silently replace it.

AC-036 still holds: when generation fails before any draft exists, the direct link to the review
platform is rendered instead, so the assistant being down never blocks a customer who wants to
write their own.

---

### AMENDMENT-023 — a review link is classified by where it actually lands

ONB-02-02 accepts `google.com` and `maps.app.goo.gl` links, and the product treated every accepted
link as equivalent. They are not. A Business Profile link (`g.page/r/{code}/review`, or
`search.google.com/local/writereview?placeid=…`) opens Google's write-a-review box with the paste
target on screen. A Maps share link opens the business listing, and a customer who has just copied
their words has to spot "Write a review" and tap again — which is where they stop.

The validator now reports a `kind` alongside the URL, and upgrades what can be upgraded safely:

- `g.page/r/{code}` gains `/review`. That is precisely what Google's own "Ask for reviews" button
  produces, and the bare form is the commonest thing an owner copies from their profile header.
- anything carrying a `placeid` is rewritten to the `writereview` endpoint.

A Maps share link is **not** converted. Reaching the composer from one requires the place id, and
that is only obtainable from the Places API — which 01_Product_Scope lists as explicitly out of V1.
The undocumented feature-id-to-place-id encoding was tried and produces a well-formed identifier
that cannot be verified without the same API: Google answers 200 for a nonsense place id and
renders the failure client-side. Shipping a rewrite on that basis risks sending real customers to
the wrong business, which is a materially worse outcome than one extra tap. So the link is stored
as given and the owner is told, on the step, that it lands on the listing and where the direct
link lives.

The wider point: ONB-02's help text has always explained this distinction, and the product still
accepted the wrong link silently. Guidance that only exists in a disclosure is guidance most people
never read.

---

### AMENDMENT-024 — Google Gemini is a supported provider, because it has a free tier

A third adapter, `GeminiProvider`, sits behind the same `AiProvider` seam as the OpenAI and
Anthropic ones. It exists for one reason: Google AI Studio's free tier prices Flash-class models at
nothing per token, so an owner can run real drafts before there is a card on file anywhere. The
OpenAI path is prepaid and the Anthropic path is billed; neither has a no-card option.

`selectProvider` precedence is now Anthropic, then OpenAI, then Gemini. Gemini is last on purpose:
it is the free tier, and an owner who later adds a paid key has upgraded — the paid key should win
without them having to remember to remove the free one. Production requires any one of the three.

Two properties of the free tier are stated in the adapter and in `.env.example` rather than left
to be discovered:

- Google's pricing page says free-tier content is "used to improve our products". Prompts carry
  merchant business context and nothing about the customer (V1 asks them nothing), but it is a
  data-handling posture the operator chooses, and 13_Security_Privacy_Compliance.md's retention
  stance ("hold nothing upstream we are not holding ourselves") does not hold on that tier.
- Rate limits are per project and visible only in AI Studio. The per-minute and the daily cap both
  arrive as `429 RESOURCE_EXHAUSTED`, mapped to `RATE_LIMITED`; the customer sees the fixed
  "assistant unavailable" message with the direct Google link still offered (AC-036).

**Thinking tokens count against `max_output_tokens` on Gemini.** That is the one place the provider
differs materially. A Flash model at its default thinking level spends several hundred tokens
reasoning before the draft, and the 320-token cap then truncates it — a non-retryable failure, not
a shorter review. The stored reasoning effort is therefore mapped onto Gemini's `thinkingLevel`:
`none` (the spec's value) and `minimal` become `minimal`, the three named levels pass through,
blank sends nothing. The default pairing is `gemini-3.5-flash-lite`, which accepts `minimal`,
with the effort left at `none`. `gemini-3.8-flash` is the stronger free model but its floor is
`low`; moving to it means raising the cap and measuring `thoughtsTokenCount` first.

The adapter is `fetch` against `generateContent` with the key in the `x-goog-api-key` header — never
the documented `?key=` query form, which a proxy access log keeps. Structured output uses
`responseJsonSchema` with the admin-owned schema verbatim, re-validated by `parseStructuredReview`.
Output tokens reported per generation include thought tokens, because Google bills them as output.
Any Google-shaped key (`AIza…`) is redacted from every failure message, not only the configured one.

---

### AMENDMENT-025 — the local stack runs detached, and a link is "live" only once it routes

14_DevOps_Deployment_Runbook.md describes production; nothing described how the product is run
for a demo, and the way it was being run failed twice in one day. The database, the tunnel and
the web server were children of whichever terminal or agent session started them, and died with
it — every printed QR then pointed at a dead host and nothing on the machine said so.

`pnpm dev:up` starts the three as detached processes with their own logs under `.dev/`, in the
only order that works (tunnel before server, because `APP_BASE_URL` is read once at boot), warms
the routes a first visitor hits (the first generation after a start had been measured at 8.4 s —
past the 8 s provider budget — on route compilation alone), and prints the link only after a
request through the public hostname has actually answered. `pnpm dev:down` stops them, asking
PostgreSQL to stop through `pg_ctl` because it detaches from its launcher and a tree-kill misses
it; `pnpm dev:status` reports what is running.

**The DNS trap, recorded because it cost a link.** cloudflared prints a quick tunnel's hostname a
few seconds before Cloudflare publishes its DNS record. A lookup inside that window returns "no
such host", and every cache on the path remembers it: the machine's for minutes, and the wifi
router's and any public resolver's for `trycloudflare.com`'s negative TTL of thirty minutes.
Every phone on that network is then locked out of the link for half an hour, while `nslookup`
— which bypasses the cache — insists it works. So no resolver is asked about the name until
cloudflared has logged its edge registration and an eight-second grace has passed; then two
independent DNS-over-HTTPS resolvers are alternated until one returns the record; only then is
the hostname resolved the way a phone would. A hostname that still fails is discarded for a fresh
one rather than handed out.

Two smaller corrections landed with it: the Redis-fallback warning in `apps/web/lib/rate-limit.ts`
prints once per check per process instead of a full stack per request (it had buried the one
line that mattered when generation failed), and `OPENAI_DEFAULT_MODEL` — read by nothing, since
the live model is `ai_prompt_versions.model` — is no longer required at boot. The production
build (`next build`) is verified to pass; the demo deliberately runs `next dev`, because
production mode also disables the landing-page demo QR and the console mail transport.

---

### AMENDMENT-026 — the database is UTF-8, drafts carry emoji, and every regeneration opens differently

**The encoding.** The embedded PostgreSQL cluster had been initialised with the operating system's
locale, which on Windows made the database `WIN1252`: no room for an emoji, a Devanagari letter,
or a business name in any non-Latin script. The first draft carrying one failed to save —
`22P05 untranslatable character` — and the customer saw a 500. Nothing had put such a character
in a draft before. `scripts/dev-db.mjs` now initialises new clusters with `--encoding=UTF8` and
the builtin `C.UTF-8` locale; `pnpm db:reencode` converts an existing one — a new UTF-8 database in
the same cluster, migrations run against it, every row copied in foreign-key order with jsonb and
identity columns handled and counts verified, then a rename swap with the old database kept as
`ai_review_win1252_backup`. The embedded build ships no `pg_dump`, which is why the script does the
copy itself. 06_Database_Schema.sql never states an encoding; a production database must be UTF-8
and the runbook should say so.

**Emoji.** The owner asked for drafts that read as written by a person, and people's Google
reviews in India carry emoji. `buildPrompt` now asks for one to three, placed after the thing they
react to or at the end, never one per sentence and never the same one twice — with the placement
itself rotated per generation (`EMOJI_PLACEMENTS`) so a page of reviews does not all end in 😋.
The similarity normaliser already strips non-letters, so emoji cannot inflate a score; the
character-length gate is unaffected; the Hinglish stub pool carries a few so the no-key demo shows
the same shape.

**Openings per generation.** Four "New review" taps in one session produced four drafts opening
with the same staff greeting: the opening hint followed the session, and nothing else moved it.
`openingHintFor(seed, generationNumber)` now advances with each generation — consecutive
regenerations are guaranteed different hints — and the emoji placement moves on its own stride so
the two do not travel together. Measured after: five drafts in one session, five openings.

**One quiet retry.** On the free Gemini tier about two calls in sixty ran past the budget, and
every one of them succeeded on the next try. `ReviewFlow` now retries once, after 1.5 s, when the
assistant answers 503 — never on 402, which will not change in a second — before showing anything.
A failed generation releases its reservation (AC-014), so the retry costs the business nothing.
`AI_REQUEST_TIMEOUT_MS` is 12 s in the local environment for the same reason; the spec's 8 s was
written against OpenAI and the free tier is spikier.

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
| OPEN-03     | Missing endpoints, mostly resolved: ~~PATCH/DELETE `/business/review-destinations/{id}`~~ (built as `PUT /business/review-destination`, AMENDMENT-003); ~~POST `/auth/reset-password`~~ (built); ~~GET `/admin/audit-logs`~~ (CHANGE-004); ~~checkout signature verification~~ (`POST /subscription/verify`, CHANGE-004). Still open: the collection-form review-destination routes the skeleton lists.                                     | various |
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
- **Production runs on Vercel (12 September 2026), not the persistent containers
  14_DevOps_Deployment_Runbook.md describes.** `docs/DEPLOY_VERCEL.md` is the runbook. What that
  changes: the web app is serverless functions in `sin1`, so `DATABASE_POOL_MIN=0` /
  `DATABASE_POOL_MAX=5` per instance against Neon's pooled (pgbouncer, transaction-mode) URL —
  safe because nothing uses session-level advisory locks, LISTEN/NOTIFY or named prepared
  statements; migrations, the seed and `create-admin` run from a developer machine against the
  unpooled URL. `apps/worker` is not deployed (no long-lived process): the analytics daily rollup,
  partition maintenance and session purge do not run, and the dashboard shows completed days as
  pending rather than as zeros. No mail transport is configured in production, so forgot-password
  answers 202 and sends nothing. The Gemini routes declare `maxDuration = 60`. pnpm 11 fails an
  install over a build script that is neither allowed nor refused, which is how
  `@embedded-postgres/linux-x64` (the local dev database's Linux binary) came to be refused
  explicitly in `pnpm-workspace.yaml`. The printable QR card wrote its text as SVG text in Arial, which the Linux host does not have, so the first production PNG had no business name; the card now outlines every glyph into paths from an embedded Inter face (`apps/web/lib/qr-card-text.ts`, `scripts/generate-qr-card-fonts.mjs`), the credit line is the Ai Review brand lockup on print and preview alike, and the unit test checks the painted pixels. The admin screens formatted dates in the server's clock —
  IST on the laptop, UTC on Vercel — and now format in `DEFAULT_TIMEZONE`. Vercel's Hobby plan is
  licensed for non-commercial use; charging businesses on it needs Pro or another host.
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

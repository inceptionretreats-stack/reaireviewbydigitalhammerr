# Known issues

Open problems found in the source, and places where documentation or code comments have drifted.
Read it before claiming the product is launch-ready, and before fixing any of these: reproduce
safely, add a failing test first, and get the project owner's approval for behaviour changes. These
are source-level findings, not proof of a live exploit. Decisions that only the project owner can
make (refunds, tax details, going live and the rest) are in
[open decisions](decisions/open-decisions.md), not here.

Each item was re-checked against the code on 24 September 2026; "Checked" says what was read, and
"Impact" says what it means for the business. The items paying businesses or their customers are
most likely to notice are 1, 2, 3, 15, 17, 18, 19 and 20; the rest are security hardening, reporting
accuracy or internal code quality. Items the handover listed that the code now shows fixed are kept
at the end of their section, marked **Resolved**, so nobody reopens them.

## Billing and quota (high priority before launch)

**1. Early renewal can interrupt Pro.** When a business that is still on an active paid year pays
again, `SubscriptionService.activatePro` starts the new period at the current expiry date. Quota
only treats Pro as active once `starts_at` is at or before now, so until the old expiry the business
falls back to its Free allowance. The `starts_at` change also fires the migration-0003 trigger that
resets Pro usage immediately. Checked: `packages/core/src/billing/subscription-service.ts`
(`activatePro`), `packages/core/src/quota/postgres-store.ts` (`resolveMode`, `starts_at <= now`
predicates), `packages/db/drizzle/0003_pro_quota_period_reset.sql`.

**Impact:** a business that renews early can find Ai drafts unavailable to its customers until its
old expiry date, although it has paid. The renewal-reminder email
(`apps/web/lib/email/email-templates.ts`) currently promises the opposite: "Renewing early adds a
year from the current end date, so no time is lost."

**2. A refunded payment can be settled again.** `CheckoutService.settleOrder` returns early only
when the payment is `CAPTURED`. A late capture callback or webhook for a `REFUNDED` payment would
mark it captured again and re-activate Pro. Checked: `packages/core/src/billing/checkout-service.ts`
(`settleOrder`).

**Impact:** a business that was refunded could get Pro back without paying.

**3. Quota can be consumed without a saved draft (partly addressed).** The generator commits the
quota reservation before the route inserts the draft. If the insert fails, the route now releases
the reservation and returns an error. A crash or timeout between commit and insert, or a failed
release, still consumes a draft the customer never received. Checked:
`packages/core/src/ai/generator.ts`, `apps/web/app/api/v1/public/review/generate/route.ts`
(`releaseQuota` after a failed insert).

**Impact:** occasionally a business loses one draft from its allowance without its customer getting
a draft.

**Resolved — failed full refund left access cancelled.** When Razorpay reports a refund failed,
`PaymentAdminService.reverseRefund` now restores the payment to `CAPTURED` and, if that payment's
own full refund had revoked Pro and nothing has changed the subscription since, restores
`PRO_ACTIVE`. Checked: `packages/core/src/billing/payment-admin-service.ts`.

## Authentication and account security

**4. Password change can leave other sessions valid.** The new password is committed first; the
sweep of other sessions and rotation of the current one run afterwards. If that step fails, the
response says so (`sessions_swept: false`) but earlier sessions remain valid. Checked:
`apps/web/app/api/v1/account/password/route.ts`.

**Impact:** in that rare failure, a device already signed in elsewhere stays signed in after the
business owner changes the password; the screen tells them so.

**5. Older reset links survive credential changes.** Forgot-password can issue several tokens; reset
consumes only the one presented; changing the password or email does not invalidate other
outstanding reset tokens. Review every token path (forgot-password, admin-initiated reset, reset,
password change, email change) before fixing. Checked:
`apps/web/app/api/v1/auth/forgot-password/route.ts`,
`apps/web/app/api/v1/auth/reset-password/route.ts`, `apps/web/lib/admin/owner-actions.ts`,
`apps/web/app/api/v1/account/` (no code touches `password_reset_tokens` on a password or email
change).

**Impact:** an earlier password-reset email still works until it expires, even after the business
owner has changed their password or email.

**Resolved — reset-password was not atomic.** Reset now claims the token, updates the password and
revokes all sessions in one transaction with `SessionService(tx)`. This does not fix item 5. Whether
this change is deployed has not been verified. Checked:
`apps/web/app/api/v1/auth/reset-password/route.ts`.

**Resolved — sign-up had no rate limit, and a legacy logout path lacked CSRF.** Sign-up now calls
`rateLimiter().signup`. `/api/v1/auth/login` exports only `POST`; sign-out is
`POST /api/v1/auth/logout`, which checks CSRF and revokes the session row. Checked:
`apps/web/app/api/v1/auth/signup/route.ts`, `.../login/route.ts`, `.../logout/route.ts`.

## Customer flow and analytics

**6. The slug review route does not record a page view.** `/{slug}/review` now restores the
session's latest draft like `/r/{code}`, but only the QR route inserts the `review_page_view` event,
so visits through a slug or a tracked request link are undercounted at that funnel step. Checked:
`apps/web/app/(customer)/[slug]/review/page.tsx`, `apps/web/app/(customer)/r/[code]/page.tsx`.

**Impact:** the analytics funnel under-counts review-page visits that did not come from a QR scan,
so conversion figures from that step are misleading.

**7. `previous_generation_id` is not ownership-checked.** The generate request is now validated with
a Zod schema (the ID must be a UUID) and selected services are checked against the resolved
business, but the ID is stored as the new draft's parent without checking that it belongs to the
same business or anonymous session. Checked: `apps/web/app/api/v1/public/review/generate/route.ts`.

**Impact:** none visible to users; a crafted request can store a misleading link between two drafts.

## Vendor workspace and CRM

**8. Ai context can be edited by a suspended or closed business.** `PUT /api/v1/ai/context` requires
a tenant but does not call `refuseFrozenTenant` (the code's name for refusing a `SUSPENDED` or
`CLOSED` business), unlike the business profile, links, review destination and review-mode routes.
Checked: `apps/web/app/api/v1/ai/context/route.ts` versus `apps/web/app/api/v1/business/route.ts`
and `apps/web/app/api/v1/ai/modes/`.

**Impact:** a business Digital Hammerr has suspended or closed can still change its Ai settings.

**9. Later CRM statuses are never written.** `AI_GENERATED`, `REVIEW_COPIED`, `GOOGLE_OPENED` and
`PRIVATE_FEEDBACK` exist in the status enum and the UI, but the only writers set `MESSAGE_PREPARED`,
`MESSAGE_SENT_MANUAL` and `LINK_CLICKED`. Do not describe a per-customer funnel beyond the link
click as implemented. Checked: callers of `advanceCustomerStatus` in
`apps/web/app/api/v1/review-requests/` and `apps/web/app/(customer)/r/req/[token]/route.ts`.

**Impact:** the customer list never shows a contact getting past "link clicked", so per-contact
tracking must not be sold as a feature.

**10. Tracked request links never expire and ignore contact deletion.** `review_requests` has no
expiry column, and the token resolver checks the business but not whether the contact was
(soft-)deleted. Deleting a contact does not revoke links already sent. Checked:
`apps/web/lib/crm/review-requests/repository.ts` (`findRequestByTrackingToken`),
`packages/db/src/schema/crm.ts`.

**Impact:** a review-request link keeps working after the business deletes that contact, which
matters if a person asks to be removed.

## Database and code structure

**11. Migration 0009's snapshot is a copy of 0008's.** `packages/db/drizzle/meta/0009_snapshot.json`
is byte-identical to `0008_snapshot.json`, including the same `id` and `prevId`. The four indexes
that `0009_hot_path_indexes.sql` creates are declared only in that SQL, not in
`packages/db/src/schema/`. Expect `drizzle-kit` to see a broken snapshot chain; fix the snapshot
(and decide whether to declare the indexes in the schema) before generating the next migration.
Checked: `cmp` of the two files, the journal, and a search of the schema for the index names.

**Impact:** none for users; the next database change is blocked until this is fixed.

**12. Migration 0009 may not be applied in production.** The last recorded production migration is
`0008_bent_darkstar` (24 September 2026). `0009_hot_path_indexes` exists in the repository; nothing
records it being applied. Check the target's migrations table read-only and ask the project owner
before applying it. Note that `pnpm dev:up` applies pending migrations to whatever database `.env`
names. Checked: `packages/db/drizzle/meta/_journal.json`,
[database on Supabase](operations/database-supabase.md).

**Impact:** without these indexes, some frequent database lookups may slow down as data grows.

**13. Date arithmetic is duplicated.** `apps/worker/src/jobs/analytics/date-bucket.ts` and
`apps/web/lib/analytics/range.ts` each define the same time-zone and local-date helpers
(`isValidTimeZone`, `resolveTimeZone`, `zoneOffsetMs`, `localDateOf`, `addDays`, `zonedStartOfDay`
and more). The web app already imports the worker's `@ai-review/worker/maintenance` export, which
re-exports the worker's copy. A fix to one must currently be made in both.

**Impact:** a date bug fixed in one copy could stay in the other, so daily figures could disagree.

**14. Validated but unused environment variables.** The schema requires `S3_BUCKET` and validates
the plan, storage, Cloudflare, SES and observability variables, but no application code reads them.
The Free/Pro allowances and price come from `platform_settings`, not from
`FREE_AI_GENERATION_LIMIT`, `PRO_ANNUAL_GENERATION_LIMIT` or `PRO_ANNUAL_PRICE_PAISE`. See
[environment](operations/environment.md). Checked: `packages/config/src/env.ts`, a search for each
name, `packages/core/src/platform/settings.ts`.

**Impact:** setting these variables changes nothing; prices and allowances are changed in
`/admin/settings`.

## Found while documenting the 24 September 2026 restructure

**15. The saved business summary is never sent to the model.** The Ai settings screens save
`ai_business_contexts.summary`, but generation builds its context from `businesses.description`
(dropped when the customer picked services) and never reads the summary. Business owners may believe
it shapes drafts. Checked: readers of `aiBusinessContexts.summary` (only
`apps/web/app/api/v1/ai/context/route.ts` and the admin loaders), `packages/core/src/ai/`.

**Impact:** business owners who write a summary expecting it to shape their drafts get no effect
from it.

**16. The business owner's test preview is lighter than the customer path.**
`POST /api/v1/ai/test-preview` makes one provider call and runs only the output compliance check: no
retries, no similarity or service-scope checks. A preview that looks fine does not prove the
customer path would accept it. Checked: `apps/web/app/api/v1/ai/test-preview/route.ts`.

**Impact:** a business owner may see a preview draft that a real customer request would reject or
retry.

**17. Plan limits are copied at sign-up.** Sign-up (password and Google) copies the current
`platform_settings` draft limits onto the new subscription row, and quota reads that row. Changing
the limits later affects only businesses created afterwards unless each row is updated. Checked:
`apps/web/app/api/v1/auth/signup/route.ts`, `apps/web/app/api/v1/auth/google/complete/route.ts`,
`packages/db/src/schema/billing.ts`.

**Impact:** raising or lowering the allowance in `/admin/settings` does not change what existing
businesses get.

**18. Three auth pages are missing from the reserved slugs.** `RESERVED_SLUGS` does not include
`invite`, `forgot-password` or `reset-password`, which are top-level pages in `app/(auth)`. A
business given one of those slugs would have its public page hidden behind the platform page.
Checked: `packages/core/src/business/slug.ts`, `apps/web/app/(auth)/`.

**Impact:** a business whose page address is one of those words would have a public page nobody can
reach.

## Found in the 24 September 2026 documentation review

**19. The price and allowances are fixed text in several places.** Only the homepage cards and
`/legal/pricing` read the live values, through `loadCommercialTerms`; checkout charges the current
`annual_price_paise` and quota uses the subscription row's limits (item 17). These places write the
figures directly and do not follow the platform settings:

- the Terms page: "₹999", "10" and "2,000";
- the Cancellation and refunds page: "₹999" for a 12-calendar-month period (it does not state the
  allowances);
- the business owner's plan notes from `describePlan` in `apps/web/lib/dashboard/presentation.ts`,
  shown on the overview and subscription screens: "Ten Ai review drafts are included. Pro adds
  2,000…" (Free) and "up to 2,000 Ai review drafts" (Pro). Nearby, the subscription page's heading
  says "Ten Ai review drafts are free for life" although it reads the Pro price and limit from the
  settings, and the onboarding finish step says "Samples do not use your 10 free generations";
- the renewal-reminder and Pro-expired emails in `apps/web/lib/email/email-templates.ts`: "2,000 Ai
  drafts a year" (the price in those emails does come from the settings).

Checked: `apps/web/app/(marketing)/legal/terms/page.tsx`,
`apps/web/app/(marketing)/legal/cancellation-refunds/page.tsx`,
`apps/web/lib/dashboard/presentation.ts` (`PLAN`),
`apps/web/app/(vendor)/app/subscription/page.tsx`,
`apps/web/components/onboarding/FinishStep.tsx`, `apps/web/lib/email/email-templates.ts`
(`renewalReminderEmail`, `subscriptionExpiredEmail`), `apps/web/lib/cron/subscriptions.ts`,
`apps/web/lib/marketing/commercial-terms.ts` and its callers.

**Impact:** if the price or allowances are changed in `/admin/settings`, the published terms, the
business owner's workspace and the renewal emails contradict what checkout charges and what
businesses actually get, until a developer edits each of these places.

**20. Local copies of the "duplicate value" check miss wrapped database errors.**
`apps/web/lib/infra/safe-error.ts` exports an `isUniqueViolation` that follows the error's `cause`
chain, because drizzle-orm wraps every driver error in a `DrizzleQueryError` with the PostgreSQL
error as its `cause`. Five private copies check only the top-level `code` and so probably never
match: `app/api/v1/qr/route.ts` and `app/api/v1/business/publish/route.ts` (retry when a new QR code
collides), `app/api/v1/business/links/[id]/route.ts` (duplicate button text),
`lib/ai/modes/mode-service.ts` (duplicate review-mode name; its `readConstraint` also reads only the
top level) and `packages/core/src/business/slug-service.ts` (two businesses claiming the same slug).
The mode-service unit test passes because its fixture is not wrapped. Not reproduced against a
database. Checked: the six definitions, and `pg-core/session.js` in the installed drizzle-orm
0.45.2.

**Impact:** a business owner who reuses a button name or review-mode name probably gets a generic
error instead of the explanation, and rare clashes fail instead of being retried or reported
clearly.

**21. Form error handling is copied, and two copies misreport server errors.** The JSON request
helper `sendJson` is defined five times and the error-envelope reader `readFailure` nine times
across `apps/web/components/` (`shared/forms/`, `dashboard/profile/request.ts`,
`dashboard/customers/`, `dashboard/settings/use-settings-submit.ts` and five onboarding files). The
two hooks, `shared/forms/use-form-submit.ts` and `dashboard/settings/use-settings-submit.ts`, call
`response.json()` unguarded, so a non-JSON error page lands in their network-failure branch.
Checked: each definition, and the users of both hooks in `components/auth/` and
`components/dashboard/settings/`.

**Impact:** when the server answers with an error page (for example during an outage), sign-in,
sign-up and account-settings forms say "Could not reach the server", which points people at their
own connection.

**22. Money and dates are formatted in several places, with different results.** The shared
`formatMoney` and `formatDate` live in `apps/web/lib/dashboard/presentation.ts` although billing
email, the renewal cron, invoices and admin pages use them. The admin overview
(`app/(admin)/admin/page.tsx`) rounds to whole rupees,
`components/admin/businesses/BusinessTabs.tsx` does not round,
`components/admin/payments/PaymentsScreen.tsx` always shows two decimals, and `formatRupees` in
`lib/marketing/commercial-terms.ts` shows "₹999.50" where `formatMoney` shows "₹999.5". The
invoice's own two-decimal rule (`invoiceMoney`) is deliberate and tested.

**Impact:** staff can see the same kind of amount written differently on different screens.

**23. The generate endpoint's request schema is duplicated, and the copies disagree.**
`app/api/v1/public/review/generate/route.ts` parses its body with its own `requestSchema` (slug and
QR code 1–160 characters, services unchecked at this stage), while the unused contract
`generateReviewRequest` in `packages/contracts/src/public.ts` says 3–48 and 6–32 characters and at
most 30 services. Only the contract's own test uses it. Changing the route to the contract would
change which requests are rejected, so it needs approval.

**Impact:** none for users; a developer who edits the contract changes nothing.

**24. Small helpers are re-declared file by file.** The UUID pattern is copied in 24 files under
`apps/web/app`, `lib` and `components`, with two exported `isUuid` functions
(`lib/crm/customers/list-params.ts`, `lib/crm/review-requests/repository.ts`); `isHttpsUrl` is
copied four times and `toStringArray` three times. The server page
`app/(vendor)/onboarding/ai/page.tsx` imports `toStringArray` from
`components/onboarding/ai-context.ts`.

**Impact:** none for users today; a rule changed in one copy silently stays different in the others.

**25. Profile-link rules are split between a page, a route and `lib/profile`.**
`app/api/v1/business/links/route.ts` redefines the default buttons, the phone and web-link type sets
and `isHttpsUrl` instead of using `lib/profile/sections.ts`, and the public page
`app/(customer)/[slug]/page.tsx` keeps its own link-building helpers (`resolveTarget`,
`externalHref`, `telHref`, `whatsAppHref`). The default button label "Review Us" is also written in
`business/publish/route.ts` and `components/onboarding/finish-preview.ts`.

**Impact:** a change to how the page buttons work must be made in several places, or the editor and
the public page can disagree.

**26. Analytics events are written from twelve places.** `lib/analytics/` holds only the read side.
Events are inserted directly in the QR, slug and feedback pages, eight route handlers and
`lib/crm/review-requests/repository.ts`, each with its own try/catch so a failed write never breaks
the request (AC-035). Only browser-sent events (`POST /api/v1/public/events`) are validated at run
time; server-built events are type-checked when compiled. This split is deliberate
([data model](architecture/data-model.md#analytics-events)), but there is no single place to find
every writer.

**Impact:** none for users; adding or changing an event means finding every place it is written.

**27. The hero and pricing-card styles live in the shared marketing stylesheet.**
`components/marketing/site/MarketingSite.module.css` (about 1,900 lines) holds the site header and
footer and also the homepage hero, the pricing cards and the parked story video's styles; the shell
component `site/MarketingSite.tsx` imports `home/HeroReviewVideo`, and
`pricing/PricingPlanCards.tsx` uses the shell's styles. Splitting the stylesheet changes cascade
order and touches visuals the project owner approved, so it needs approval and before/after
screenshots.

**Impact:** a change to the hero or pricing cards can unintentionally change other marketing pages.

## Documentation and comment drift

- The frozen spec in `docs/spec/` says `review.digitalhammerr.com`, English-only drafts, unlimited
  or fair-use Pro (the Word PRD still does) and a separately hosted API service. The project owner
  later chose `aireview.digitalhammerr.com`, Hinglish and English drafts, 2,000 Pro drafts a year
  and Next.js route handlers on Vercel. The spec was last updated on 10 September 2026, only for the
  2,000-draft Pro cap and "Ai" casing (D-030, D-031); it must not be edited now, and
  [spec amendments](decisions/spec-amendments.md) records every other change. Its glossary
  (`docs/spec/24_Glossary.md`) still gives the old address and "AI" casing; the current one is
  [glossary.md](glossary.md).
- [Spec amendments](decisions/spec-amendments.md) itself contains superseded statements
  (DigitalOcean hosting and an `infra/` folder in ADR-AMEND-B, Neon and "no mail transport" in the
  implementation notes, OPEN-01 and OPEN-02 still listed as open). Since 24 September 2026 a status
  note at the top of that file lists them; the entries are not rewritten. Older open-item lists
  elsewhere include work that was done later too; check the code rather than copying an old
  checklist.
- `docs/openapi/v1.yaml` (around line 2664) still says nothing resolves
  `review_requests.tracking_token_hash`; `GET /r/req/{token}` has done so since OPEN-02 was closed.
- The [historical Vercel runbook](history/2026-09-17-vercel-deploy-runbook.md) still describes Neon
  and Upstash, says the worker and email are not running, suggests unsetting `NODE_ENV` for seeding
  production (rejected), and says rotating `SESSION_SECRET` signs everyone out. `SESSION_SECRET`
  only signs the short-lived Google sign-in cookies; session tokens are stored as plain SHA-256
  hashes.
- Code comments that disagree with the code: `packages/core/src/ai/generator.ts` says the generator
  "retries at most once" while `MAX_ATTEMPTS` is 3 within one shared time budget; the generate
  route's `maxDuration` comment says the generator "retries once on a 503", but the 503 retry
  happens in the browser (`apps/web/components/customer/review/ReviewFlow.tsx`, after about 1.5 s).
  The same `maxDuration` comment is copied into `apps/web/app/api/v1/ai/test-preview/route.ts`,
  although the preview does not use the generator and makes a single provider call (item 16).
- `packages/core/src/rate-limit/policies.ts` (header comment) and `scripts/db/seed.ts` (the demo
  subscription) still call `FREE_AI_GENERATION_LIMIT` a "bootstrap default", although nothing reads
  that variable; the Free allowance comes from `platform_settings` (item 14).
  The old comments naming `middleware.ts` for the anonymous cookie were corrected to `proxy.ts` on
  24 September 2026 except one: `apps/web/app/(customer)/r/[code]/page.tsx` still says the token is
  "minted by middleware" (it is minted in `apps/web/proxy.ts`). (The `.env.example` notes about
  "Marketplace Postgres" and plan "bootstrap defaults", and the CI comment naming
  `vitest.integration.config.ts`, were corrected on 24 September 2026.)
- Model prices and unit economics in `spec-amendments.md` and in `.env.example` comments are dated
  and price OpenAI models; re-verify before any financial or procurement decision (see
  [open decisions](decisions/open-decisions.md#ai-provider-and-running-cost)).

# Known issues

Open problems found in the source, operational decisions still waiting on the owner, and places
where documentation or code comments have drifted. Read it before claiming the product is
launch-ready, and before fixing any of these: reproduce safely, add a failing test first, and get
approval for behaviour changes. These are source-level findings, not proof of a live exploit.

Each item was re-checked against the code on 24 September 2026; "Checked" says what was read.
Items the handover listed that the code now shows fixed are kept at the end of their section,
marked **Resolved**, so nobody reopens them.

## Billing and quota (high priority before launch)

**1. Early renewal can interrupt Pro.** When a business that is still on an active paid year pays
again, `SubscriptionService.activatePro` starts the new period at the current expiry date. Quota
only treats Pro as active once `starts_at` is at or before now, so until the old expiry the business
falls back to its Free allowance. The `starts_at` change also fires the migration-0003 trigger that
resets Pro usage immediately.
Checked: `packages/core/src/billing/subscription-service.ts` (`activatePro`),
`packages/core/src/quota/postgres-store.ts` (`resolveMode`, `starts_at <= now` predicates),
`packages/db/drizzle/0003_pro_quota_period_reset.sql`.

**2. A refunded payment can be settled again.** `CheckoutService.settleOrder` returns early only
when the payment is `CAPTURED`. A late capture callback or webhook for a `REFUNDED` payment would mark
it captured again and re-activate Pro.
Checked: `packages/core/src/billing/checkout-service.ts` (`settleOrder`).

**3. Quota can be consumed without a saved draft (partly addressed).** The generator commits the
quota reservation before the route inserts the draft. If the insert fails, the route now releases
the reservation and returns an error. A crash or timeout between commit and insert, or a failed
release, still consumes a draft the customer never received.
Checked: `packages/core/src/ai/generator.ts`, `apps/web/app/api/v1/public/review/generate/route.ts`
(`releaseQuota` after a failed insert).

**Resolved — failed full refund left access cancelled.** When Razorpay reports a refund failed,
`PaymentAdminService.reverseRefund` now restores the payment to `CAPTURED` and, if that payment's own
full refund had revoked Pro and nothing has changed the subscription since, restores `PRO_ACTIVE`.
Checked: `packages/core/src/billing/payment-admin-service.ts`.

## Authentication and account security

**4. Password change can leave other sessions valid.** The new password is committed first; the
sweep of other sessions and rotation of the current one run afterwards. If that step fails, the
response says so (`sessions_swept: false`) but earlier sessions remain valid.
Checked: `apps/web/app/api/v1/account/password/route.ts`.

**5. Older reset links survive credential changes.** Forgot-password can issue several tokens;
reset consumes only the one presented; changing the password or email does not invalidate other
outstanding reset tokens. Review every token path (forgot-password, admin-initiated reset, reset,
password change, email change) before fixing.
Checked: `apps/web/app/api/v1/auth/forgot-password/route.ts`,
`apps/web/app/api/v1/auth/reset-password/route.ts`, `apps/web/lib/admin/owner-actions.ts`,
`apps/web/app/api/v1/account/` (no code touches `password_reset_tokens` on a password or email
change).

**Resolved — reset-password was not atomic.** Reset now claims the token, updates the password and
revokes all sessions in one transaction with `SessionService(tx)`. This does not fix item 5. Whether
this change is deployed has not been verified.
Checked: `apps/web/app/api/v1/auth/reset-password/route.ts`.

**Resolved — sign-up had no rate limit, and a legacy logout path lacked CSRF.** Sign-up now calls
`rateLimiter().signup`. `/api/v1/auth/login` exports only `POST`; sign-out is
`POST /api/v1/auth/logout`, which checks CSRF and revokes the session row.
Checked: `apps/web/app/api/v1/auth/signup/route.ts`, `.../login/route.ts`, `.../logout/route.ts`.

## Customer flow and analytics

**6. The slug review route does not record a page view.** `/{slug}/review` now restores the
session's latest draft like `/r/{code}`, but only the QR route inserts the `review_page_view` event,
so visits through a slug or a tracked request link are undercounted at that funnel step.
Checked: `apps/web/app/(customer)/[slug]/review/page.tsx`, `apps/web/app/(customer)/r/[code]/page.tsx`.

**7. `previous_generation_id` is not ownership-checked.** The generate request is now validated with
a Zod schema (the ID must be a UUID) and selected services are checked against the resolved
business, but the ID is stored as the new draft's parent without checking that it belongs to the same
business or anonymous session.
Checked: `apps/web/app/api/v1/public/review/generate/route.ts`.

## Vendor workspace and CRM

**8. Ai context can be edited by a frozen business.** `PUT /api/v1/ai/context` requires a tenant but
does not call `refuseFrozenTenant`, unlike the business profile, links, review destination and
review-mode routes.
Checked: `apps/web/app/api/v1/ai/context/route.ts` versus `apps/web/app/api/v1/business/route.ts`
and `apps/web/app/api/v1/ai/modes/`.

**9. Later CRM statuses are never written.** `AI_GENERATED`, `REVIEW_COPIED`, `GOOGLE_OPENED` and
`PRIVATE_FEEDBACK` exist in the status enum and the UI, but the only writers set
`MESSAGE_PREPARED`, `MESSAGE_SENT_MANUAL` and `LINK_CLICKED`. Do not describe a per-customer funnel
beyond the link click as implemented.
Checked: callers of `advanceCustomerStatus` in `apps/web/app/api/v1/review-requests/` and
`apps/web/app/(customer)/r/req/[token]/route.ts`.

**10. Tracked request links never expire and ignore contact deletion.** `review_requests` has no
expiry column, and the token resolver checks the business but not whether the contact was
(soft-)deleted. Deleting a contact does not revoke links already sent.
Checked: `apps/web/lib/crm/review-requests/repository.ts` (`findRequestByTrackingToken`),
`packages/db/src/schema/crm.ts`.

## Database and code structure

**11. Migration 0009's snapshot is a copy of 0008's.** `packages/db/drizzle/meta/0009_snapshot.json`
is byte-identical to `0008_snapshot.json`, including the same `id` and `prevId`. The four indexes
that `0009_hot_path_indexes.sql` creates are declared only in that SQL, not in
`packages/db/src/schema/`. Expect `drizzle-kit` to see a broken snapshot chain; fix the snapshot (and
decide whether to declare the indexes in the schema) before generating the next migration.
Checked: `cmp` of the two files, the journal, and a search of the schema for the index names.

**12. Migration 0009 may not be applied in production.** The last recorded production migration is
`0008_bent_darkstar` (24 September 2026). `0009_hot_path_indexes` exists in the repository; nothing
records it being applied. Check the target's migrations table read-only and ask the owner before
applying it. Note that `pnpm dev:up` applies pending migrations to whatever database `.env` names.
Checked: `packages/db/drizzle/meta/_journal.json`, [database on Supabase](operations/database-supabase.md).

**13. Date arithmetic is duplicated.** `apps/worker/src/jobs/analytics/date-bucket.ts` and
`apps/web/lib/analytics/range.ts` each define the same time-zone and local-date helpers
(`isValidTimeZone`, `resolveTimeZone`, `zoneOffsetMs`, `localDateOf`, `addDays`, `zonedStartOfDay`
and more). The web app already imports the worker's `@ai-review/worker/maintenance` export, which
re-exports the worker's copy. A fix to one must currently be made in both.

**14. Validated but unused environment variables.** The schema requires `S3_BUCKET` and validates
the plan, storage, Cloudflare, SES and observability variables, but no application code reads them.
The Free/Pro allowances and price come from `platform_settings`, not from
`FREE_AI_GENERATION_LIMIT`, `PRO_ANNUAL_GENERATION_LIMIT` or `PRO_ANNUAL_PRICE_PAISE`. See
[environment](operations/environment.md).
Checked: `packages/config/src/env.ts`, a search for each name, `packages/core/src/platform/settings.ts`.

## Found while documenting the 24 September 2026 restructure

**15. The saved business summary is never sent to the model.** The Ai settings screens save
`ai_business_contexts.summary`, but generation builds its context from `businesses.description`
(dropped when the customer picked services) and never reads the summary. Owners may believe it shapes
drafts.
Checked: readers of `aiBusinessContexts.summary` (only `apps/web/app/api/v1/ai/context/route.ts` and
the admin loaders), `packages/core/src/ai/`.

**16. The owner's test preview is lighter than the customer path.** `POST /api/v1/ai/test-preview`
makes one provider call and runs only the output compliance check: no retries, no similarity or
service-scope checks. A preview that looks fine does not prove the customer path would accept it.
Checked: `apps/web/app/api/v1/ai/test-preview/route.ts`.

**17. Plan limits are copied at sign-up.** Sign-up (password and Google) copies the current
`platform_settings` draft limits onto the new subscription row, and quota reads that row. Changing
the limits later affects only businesses created afterwards unless each row is updated.
Checked: `apps/web/app/api/v1/auth/signup/route.ts`, `apps/web/app/api/v1/auth/google/complete/route.ts`,
`packages/db/src/schema/billing.ts`.

**18. Three auth pages are missing from the reserved slugs.** `RESERVED_SLUGS` does not include
`invite`, `forgot-password` or `reset-password`, which are top-level pages in `app/(auth)`. A business
given one of those slugs would have its public page hidden behind the platform page.
Checked: `packages/core/src/business/slug.ts`, `apps/web/app/(auth)/`.

## Owner and operations decisions still pending

These need the owner, not a code change. Do not invent answers in code or copy.

- **Refunds.** The exact Pro refund window, eligibility and processing time are unconfirmed; the
  public cancellation page says so. Do not add an automatic refund or a blanket no-refund rule.
- **Seller and tax details.** Legal seller identity, address and GST registration are unconfirmed.
  The defaults in `packages/core/src/platform/settings.ts` have an empty address and no GSTIN, so no
  GST split is printed until an admin fills them in.
- **Privacy and retention.** Final retention and deletion process and a legal review are pending. Do
  not promise erasure deadlines, provider training exclusions or certifications.
- **Email sender domain.** Resend sender-domain (DNS) verification is paused by the owner. Resume only
  with permission and access to the correct DNS zone.
- **Payments mode.** As of 24 September 2026 production deliberately uses Razorpay test-mode
  credentials, by the owner's choice; this is not a defect. Going live means switching to live keys,
  re-registering the webhook and confirming a hosting plan that permits commercial use
  ([deploy-vercel.md](operations/deploy-vercel.md) notes that Vercel Hobby is non-commercial), all
  together and with approval.
- **Launch verification.** Before any launch claim, verify in production: the Ai provider and active
  prompt, price and allowance settings, `ADMIN_MFA_REQUIRED`, payment credentials and webhooks, cron
  execution, migration state, Redis reachability, backup and restore, and email delivery.
- **Search indexing.** `apps/web/app/layout.tsx` sets `robots: { index: false }`. Removing it is a
  launch decision, not a clean-up.
- **Non-production database settings.** The handover recorded that the Vercel project's non-production
  `DATABASE_URL` still pointed at the retired Neon database. Do not reopen that database to make a
  preview work; decide the preview database separately.
- **Custom domains.** Schema tables and Cloudflare variables exist, but the worker's domain poller
  uses `UnconfiguredCustomDomainProvider` and nothing reads the Cloudflare variables. Custom domains
  are not available.
- **Public media.** Superseded marketing media was deleted on 24 September 2026 (it is in git
  history). The parked story video and its poster remain publicly reachable under
  `apps/web/public/marketing/` although nothing mounts them. See
  [marketing material](marketing/README.md).

## Documentation and comment drift

- The frozen spec in `docs/spec/` says `review.digitalhammerr.com`, English-only drafts, unlimited or
  fair-use Pro and a separately hosted API service. The owner later chose
  `aireview.digitalhammerr.com`, Hinglish and English drafts, 2,000 Pro drafts a year and Next.js
  route handlers on Vercel. [Spec amendments](decisions/spec-amendments.md) records the changes; the
  spec itself is never edited.
- [deploy-vercel.md](operations/deploy-vercel.md) still describes Neon and Upstash, says the worker
  and email are not running, suggests unsetting `NODE_ENV` for seeding production (rejected), and
  says rotating `SESSION_SECRET` signs everyone out. `SESSION_SECRET` only signs the short-lived
  Google sign-in cookies; session tokens are stored as plain SHA-256 hashes.
- `.env.example` says production uses "Marketplace Postgres" (it is Supabase) and that the plan
  variables are bootstrap defaults taken over by `platform_settings` (they are not read at all).
- Code comments that disagree with the code: `packages/core/src/ai/generator.ts` says the generator
  "retries at most once" while `MAX_ATTEMPTS` is 3 within one shared time budget; the generate
  route's `maxDuration` comment says the generator "retries once on a 503", but the 503 retry
  happens in the browser (`apps/web/components/customer/review/ReviewFlow.tsx`, after about 1.5 s);
  `.github/workflows/ci.yml` names `vitest.integration.config.ts` (the file is `.mts`). (The old
  comments naming `middleware.ts` for the anonymous cookie were corrected to `proxy.ts` on
  24 September 2026.)
- Older open-item lists include work that was done later (for example atomic quota reservation and
  tracked-request token resolution). Check the code rather than copying an old checklist.
- Model prices and unit economics in the spec and in `.env.example` comments are dated; re-verify
  before any financial or procurement decision.

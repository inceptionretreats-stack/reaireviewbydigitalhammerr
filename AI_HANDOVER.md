# Ai Review by Digital Hammerr — AI project handover

Last reviewed: **18 September 2026**. This is an internal working handover, not a launch-readiness certificate or a public legal policy.

## 1. Start here

This project is an Ai-assisted review-writing SaaS for local businesses. A business creates an account, configures its Google review destination, and displays a dynamic QR. Customers scan it, receive an editable draft, confirm it reflects their experience, copy it, and choose whether to paste and post it on Google themselves.

**The application does not automatically publish Google reviews, verify publication, collect a star rating, or guarantee more reviews.** Its analytics describe observable actions such as scans, generation, copying and opening Google.

Read this file before changing the project. Then inspect the relevant current source: this document is a dated snapshot, and later user instructions and code changes may supersede it. Recommendations and unresolved findings below are not authorization to perform migrations, deploy, send messages, charge/refund payments, or modify production data.

### Project identity

| Item                                     | Current context                                                                                                                                     |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Brand                                    | Ai Review by Digital Hammerr                                                                                                                        |
| Company                                  | Digital Hammerr is a digital marketing company offering app development, website development, SEO and graphic design. Do not describe it as a cafe. |
| Working directory on the current machine | `C:/Users/digital hammerr/Downloads/reaireviewbydigitalhammerr`                                                                                     |
| Local preview                            | `http://127.0.0.1:3000/`                                                                                                                            |
| Owner-specified public subdomain         | `aireview.digitalhammerr.com` — current DNS/live availability must be verified separately                                                           |
| Historical Vercel project                | `ai-review-dh`; verify actual project linkage and account before any deployment                                                                     |
| Deployment account preference            | The user explicitly requested the **Inception** account. Do not deploy to another account by default.                                               |
| Git snapshot at handover                 | Branch `main`; latest commit observed: `4c370b8` — `Release latest website, review video, and dashboard updates`                                    |
| Important status                         | There are substantial uncommitted and untracked changes. The latest pricing/legal/marketing work has **not been deployed by this task**.            |

### First instructions for the next Ai

1. Run `git status --short` and inspect relevant diffs before editing. Preserve existing work; do not reset, clean, blanket-stage, or overwrite unfamiliar changes.
2. The user previously requested approval before each proposed change and no changes to the core idea. Treat a new explicit request as approval for that named scope, but ask before expanding it.
3. Read `apps/web/AGENTS.md`. Before web-code changes, use the installed version's guides in `apps/web/node_modules/next/dist/docs/`, not assumptions from older Next.js versions.
4. Keep the existing stack. The user considered Supabase, then explicitly said to leave the previous stack in place. Do not restart a Supabase migration without new approval.
5. Never copy `.env`, `.env.local`, `.vercel` environment exports, credentials, production data or secret-bearing logs into this document, chat, screenshots, commits or deployment uploads.
6. Distinguish **implemented locally**, **tested locally**, **documented historically**, and **verified live**. They are not interchangeable.

## 2. Latest decisions: do not accidentally undo these

- User-facing product casing is generally **Ai**, not AI. Preserve technical identifiers such as `AI_PROVIDER_UNAVAILABLE` and vendor name OpenAI. The current hero sentence was explicitly supplied as `Review Likhna Ab Easy Hai — AI Hai Na.`; do not silently rewrite approved copy while doing unrelated work.
- Keep the Hinglish hero, readable spacing, strong typography, blue/Google-colour theme and robot artwork. The owner asked for robots instead of a girl in illustrative website content.
- Keep How it works in **three steps**, with full phones visible, thin bezels and video explanations. Do not restore an eight-step grid or replace actual product screenshots with generic mockups.
- The business-type strip above How it works is an infinite business-category marquee, not verified customer logos/testimonials. Do not present categories as real named customers.
- Use Digital Hammerr in visible demo branding, with marketing/development/SEO/design context. Some internal seeded slugs still contain `demo-south-cafe`; changing identifiers can break references and is not a cosmetic text replacement.
- Free is 10 total Ai drafts per business profile. Standard Pro is INR 999 for 12 calendar months and 2,000 Ai drafts per paid period. Do not restore unlimited Pro or call the allowance verified posted reviews.
- Unsupported `10X in 90 days`, timed-completion promises and similar claims were removed from active marketing. Do not reintroduce them without evidence and approval.
- The shopkeeper promotional story video is currently **not mounted on the homepage** because its embedded claims/dialogue were not verified. Its component and original media remain. This is separate from permission to use the media.
- The original detailed billing block must **not** be displayed beneath the homepage cards, and the cards must **not expand inline**.
- **Final approved pricing interaction:** each card has a `Show more` link. Free opens `/legal/pricing/free`; Pro opens `/legal/pricing/pro`. Each separate page has `Back to pricing`, returning to `/#pricing`, and a comparison link to the other plan. Cards stay the same size.
- Footer links expose Privacy, Terms, Cancellation / Refunds and Contact without login. Signup Terms/Privacy links open a new tab, preserving typed fields and checkbox state.
- Email-domain/DNS verification was explicitly paused by the owner. Do not resume Cloudflare changes without permission.

## 3. Architecture and repository map

The backend is **inside the Next.js application**, mostly App Router route handlers under `/api/v1`, backed by shared domain services. There is no separate NestJS service to deploy for the current implementation.

```text
Merchant / customer / admin browser
                |
                v
Next.js web app: pages, React components, proxy and API handlers
                |
                +--> @ai-review/core: auth, tenant rules, Ai, quota, billing
                +--> PostgreSQL through Drizzle / pg
                +--> Redis for rate limits; BullMQ for standalone worker jobs
                +--> configured Ai provider
                +--> Razorpay for order/payment/refund operations
                +--> Resend for transactional email when configured

Vercel Cron handlers --> shared maintenance/domain services --> PostgreSQL / Redis
Optional standalone worker --> scheduled BullMQ jobs
```

| Directory            | Responsibility                                                                         |
| -------------------- | -------------------------------------------------------------------------------------- |
| `apps/web`           | Next.js pages, API, marketing, merchant/customer/admin UI, integration assembly        |
| `apps/worker`        | BullMQ jobs; also exports side-effect-free maintenance helpers used by web Cron        |
| `packages/core`      | Domain logic: generation, prompts, quality gates, auth, quota, billing, tenancy, abuse |
| `packages/db`        | Drizzle schemas, PostgreSQL connection, migrations and snapshots                       |
| `packages/contracts` | Shared API contracts/validation                                                        |
| `packages/config`    | Environment schema and configuration validation                                        |
| `packages/analytics` | Analytics taxonomy/types; generated event contract                                     |
| `packages/ui`        | Shared UI controls/components                                                          |
| `e2e`                | Playwright browser tests                                                               |
| `scripts`            | Local startup, seed, migrations/helpers, operators, media generation and other tooling |
| `docs/spec`          | Original product/development pack; useful history, not always current behaviour        |

Observed toolchain: Node >=24, pnpm 11.24.0, Next.js 16.3.3, React 19.2.8, TypeScript 6.0.3, Drizzle ORM and PostgreSQL. Local embedded PostgreSQL is version 18; integration CI uses PostgreSQL 17. CSS modules and shared UI styles are both used; the root website font is locally bundled DM Sans via `next/font/local`.

### Hosting: distinguish documentation from live verification

The deployment runbook describes Vercel web hosting, Neon PostgreSQL and Upstash Redis. This is the retained stack/context, **not proof that every live integration is healthy today**. The application uses its own authentication/session system, not Supabase Auth, Firebase Auth or an external auth SDK.

`docs/DEPLOY_SUPABASE.md` is an abandoned/paused option, not the current approved direction. Even that document describes retaining custom app authentication if PostgreSQL hosting were ever migrated. Do not add `auth.uid()`-based policies as though existing sessions were Supabase sessions.

## 4. Routes and screens

### Public and marketing

| URL                                                                 | Meaning                                                                                                    |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `/`                                                                 | Main landing page                                                                                          |
| `/#home`, `/#how-it-works`, `/#why-ai-review`, `/#pricing`, `/#faq` | Landing-page anchors                                                                                       |
| `/pricing`, `/features`, `/how-it-works`                            | Legacy marketing paths redirect into the single homepage; inspect their page files before changing routing |
| `/legal/privacy`                                                    | Public Privacy Policy                                                                                      |
| `/legal/terms`                                                      | Public Terms                                                                                               |
| `/legal/cancellation-refunds`                                       | Public cancellation/refund information, with unconfirmed eligibility explicitly disclosed                  |
| `/legal/contact`                                                    | Public support/contact information                                                                         |
| `/legal/pricing/free`, `/legal/pricing/pro`                         | Separate plan details pages reached by card `Show more` links                                              |
| `/{slug}`                                                           | Public business/contact-link profile, **not** the Ai editor                                                |
| `/{slug}/review`                                                    | Ai review-writing flow entered by business slug                                                            |
| `/{slug}/feedback`                                                  | Private feedback form                                                                                      |
| `/r/{code}`                                                         | Immutable opaque QR route; resolves current business configuration and opens the Ai flow                   |
| `/r/req/{token}`                                                    | Opaque tracked review-request URL; records a link visit then redirects to the current slug's Ai flow       |

`/legal` was already a reserved namespace. Keep static public information there so a new page does not hijack an existing business slug.

### Merchant

Authentication: `/signup`, `/login`, `/forgot-password`, `/reset-password`.

Onboarding: `/onboarding/business` → `/onboarding/review-link` → `/onboarding/links` → `/onboarding/ai` → `/onboarding/finish`.

Dashboard routes: `/app`, `/app/profile`, `/app/qr`, `/app/ai-review`, `/app/review-modes`, `/app/analytics`, `/app/customers`, `/app/review-requests`, `/app/feedback`, `/app/subscription`, `/app/subscription/receipts/{id}`, `/app/settings`.

### Admin

`/admin`, `/admin/businesses`, `/admin/businesses/{id}`, `/admin/ai`, `/admin/ai/{id}`, `/admin/settings`, `/admin/payments`, `/admin/payments/{id}/invoice`, `/admin/activity`, `/admin/audit`, `/admin/team`, `/admin/team/{id}`.

Admin MFA/invite routes also exist under `/login/mfa`, `/login/mfa/enrol` and `/invite`. Access is server-guarded; hiding an admin link is not authorization.

## 5. Merchant account, onboarding and profile flow

1. `SignupForm.tsx` collects account information and acceptance. `POST /api/v1/auth/signup` creates a `BUSINESS_OWNER`, a `DRAFT` business shell and a `FREE` subscription in a transaction.
2. Session creation happens after that transaction. If it fails, the route tells the user the account exists and directs them to sign in; it must not misleadingly ask them to register the same email again.
3. Progress is derived from persisted data (`apps/web/lib/onboarding-progress.ts`), not only a client-side step number.
4. The owner enters business identity and a primary slug, then a Google review destination. Optional contact links and Ai context are subsequent steps.
5. Publish requires valid, non-placeholder business identity, a primary slug and the Google review destination. Optional links/context do not block publishing.
6. Publishing atomically activates the business and creates its first `Main QR`. Republishing preserves the original publication time.
7. The merchant dashboard then manages QR, configuration, usage, customers, feedback and billing.

Sources: `apps/web/app/api/v1/auth/signup/route.ts`, `apps/web/components/onboarding/steps.ts`, `apps/web/lib/onboarding-progress.ts`, `apps/web/app/api/v1/business/publish/route.ts`.

### Location changes without reprinting

The primary review URL belongs to `review_destinations`. A `GOOGLE_REVIEW` business-link row carries display/order information, not another authoritative copy of the URL.

`PUT /api/v1/business/review-destination` validates the Google URL and updates the destination/configuration version transactionally. An existing QR still encodes `/r/{code}` and reads the saved destination at visit time. Do not replace the dynamic QR payload with a literal Google Maps link.

Profile editing uses separate requests for identity and link sections; it is not one all-or-nothing transaction. Link reordering saves immediately. Logo/cover uploads and brand-accent editing are currently unavailable in the profile editor; do not claim the presence of storage env variables proves uploads are implemented.

Sources: `apps/web/components/dashboard/profile/ProfileEditor.tsx`, `apps/web/app/api/v1/business/review-destination/route.ts`, `apps/web/app/api/v1/business/links/`.

## 6. Customer review flow, end to end

```text
Scan printed dynamic QR
  -> /r/{code}
  -> resolve enabled QR and ACTIVE business
  -> establish business-bound anonymous session; record scan/page-view events
  -> restore latest original draft, or auto-generate a draft
  -> customer edits OR requests New review
  -> customer confirms genuine experience
  -> Copy & open Google
  -> copy attempt + external Google page
  -> CUSTOMER pastes, chooses a rating and posts on Google

Private feedback is an optional path available to everyone throughout the journey.
```

- A customer does not need an Ai Review account or app. Google may require its own login to post.
- No star-selection screen, rating gate, sentiment questionnaire or positive-only routing belongs in this flow.
- `ReviewFlow.tsx` starts generation on arrival unless given an initial draft. `New review` regenerates and clears the previous genuine-experience confirmation.
- The editable text is browser state. The customer must confirm genuine experience, provide nonempty text and stay within the 1,200-character editor limit before the combined copy/Google action.
- Clipboard writing starts during the user click; Google opens via ordinary new-tab navigation. Record `review_copy` only on clipboard success. On clipboard failure, select text and offer a manual-copy fallback.
- A Google-open event is an attempt to open the destination, not evidence of publication. No code or UI should claim a review was submitted successfully to Google.
- Editing, copying or opening Google does not consume another Ai draft. Requesting a new generated draft does.
- The server stores the original generated wording. Customer edits are not persisted as the edited review text by edit/copy telemetry, and refreshing can lose unsaved edits.
- The QR route restores the latest original draft; the slug route currently differs. See known issues before promising identical reload behaviour for all entry routes.

**Important route distinction:** the `Review Us` action on `/{slug}` currently opens the configured Google destination directly. The Ai experience is at `/{slug}/review` or `/r/{code}`. Do not confuse the profile with the editor when testing.

Sources: `apps/web/components/ReviewFlow.tsx`, `apps/web/components/DraftEditor.tsx`, `apps/web/app/r/[code]/page.tsx`, `apps/web/app/[slug]/review/page.tsx`, `apps/web/lib/anonymous-session.ts`, `apps/web/lib/resolve-public-ref.ts`.

## 7. Generation, prompts, quotas and provider flow

The main endpoint is `POST /api/v1/public/review/generate`.

1. Resolve the public slug/QR to an internal business on the server. Never trust a browser-supplied internal business ID.
2. Check business/QR availability, anonymous session, admin Ai suspension/throttle and rate-limit rules.
3. Read the ACTIVE row in `ai_prompt_versions`, business identity/context, draft language and active review mode.
4. Load up to three earlier generated drafts for that anonymous session for variation/similarity checks.
5. Select the provider from configured credentials: **Anthropic → OpenAI → Gemini → local deterministic stub** if none exists. The stub is for non-production development; production configuration requires a provider key.
6. Reserve quota atomically before an expensive provider request.
7. Build the prompt from the active version, business context, language and mode. Apply output/compliance/similarity checks. The generator currently allows up to **three internal attempts within a shared time budget**; older comments saying one retry are not the full current rule.
8. A successful generation commits one quota reservation. Provider/quality rejection releases it. Internal attempts do not each consume a customer draft.
9. The route persists generation text/metadata and records analytics. There is an unresolved gap between quota commit and database persistence; see known issues.

The browser also retries one 503 after approximately 1.5 seconds. Keep this distinct from the generator's internal attempts when reasoning about cost, quota and latency.

The ACTIVE database prompt controls the actual model and rules. Changing a legacy model environment variable does not necessarily change an existing active prompt row. Admin prompt versions support draft/activate/archive/rollback rather than silently editing historical generated content.

Draft languages currently supported: `hinglish` (default, Roman-script Hindi mixed with English) and `en`. Review modes are contextual emphasis, not tone/rating coercion or a separate language setting. Context terms are hints, not mandatory merchant-selected praise.

There is no automatic cross-provider or expensive fallback-model failover. Do not add one without explicit cost/product approval. Historical model pricing in the specification is not a current procurement quote.

Sources: `apps/web/lib/generation-service.ts`, `packages/core/src/ai/generator.ts`, `packages/core/src/ai/prompt-builder.ts`, `packages/core/src/ai/prompt-version-service.ts`, `packages/core/src/quota/`, `packages/core/src/rate-limit/`.

## 8. Pricing, payments and subscription lifecycle

### Standard terms verified from code and local configuration

| Item                    | Behaviour                                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Free                    | 10 total Ai drafts per business profile; not a monthly/yearly refill; no scheduled expiry of unused Free drafts     |
| Pro                     | Standard INR 999 for 12 calendar months, 2,000 drafts per paid period                                               |
| Business/location scope | Allowance belongs to one business profile and primary Google destination; no multi-location bundle is advertised    |
| Regeneration            | Another successful customer generation consumes another draft; no separate per-regeneration monetary fee            |
| Merchant test preview   | Does not consume customer draft quota                                                                               |
| Exhausted allowance     | Further Ai drafting is unavailable; customers can still use Google and write their own review                       |
| Pro expiry              | No paid-draft rollover; only any unused original Free allowance remains                                             |
| Renewal                 | Another annual payment is required; the current standard checkout is not an automatic recurring subscription charge |
| Tax                     | No separate surcharge is added by checkout; invoice splitting depends on configured seller/tax information          |
| Refund eligibility      | Owner has not yet confirmed the exact eligibility, deadline or processing time; do not invent them                  |

Local read-only verification on 18 September found Free=10 and Pro=2,000 stored in platform settings. Price used the application default of 99,900 paise. Local seller GSTIN and state were absent, so no GST split was configured. These findings do **not** verify live production settings, tax registration or legally applicable rates.

`packages/core/src/platform/settings.ts` contains defaults and versioned settings. Checkout reads the database price, while public card/details/FAQ copy contains standard static amounts. If an admin changes pricing or allowances, review all customer-facing copy for drift. Existing payments/invoices are historical snapshots and must not be rewritten to today's price.

### Payment flow

```text
Signed-in owner opens subscription screen
  -> POST /api/v1/subscription/checkout
  -> server chooses amount and creates Razorpay order + local payment record
  -> customer completes Razorpay checkout
  -> signed browser callback to /subscription/verify and/or signed webhook
  -> server checks signature, ownership and amount
  -> transactional settlement + SubscriptionService.activatePro
  -> store purchased period / invoice snapshot; attempt configured receipt email
```

The external webhook is `/api/v1/webhooks/razorpay`. Verify the signature over the raw request body. A client success screen or bank debit alone is not authority to grant Pro. Admin entitlement grants also use `SubscriptionService`, with reason/audit data.

The admin payments area includes reconciliation/refund tools. These have real external effects and require explicit authorization. Do not exercise live payments or refund flows as a generic UI test.

Sources: `apps/web/lib/subscription.ts`, `packages/core/src/billing/checkout-service.ts`, `packages/core/src/billing/subscription-service.ts`, `packages/core/src/billing/payment-admin-service.ts`, `packages/core/src/billing/invoice-service.ts`, `packages/core/src/billing/lifecycle-service.ts`.

## 9. Private feedback, CRM and review requests

### Private feedback

`/{slug}/feedback` accepts a required message and optional name/mobile. `/api/v1/public/feedback` stores it for that business. It is not published on Google and is not a Digital Hammerr support ticket. `/app/feedback` lets the owner read/archive it. Do not place contact details or message contents in analytics properties.

### CRM and manual WhatsApp flow

1. The merchant adds/edits an individual tenant-owned contact in `/app/customers`. Phone numbers are normalized and checked for duplicates. Deletion is soft deletion.
2. The merchant prepares a review request through `/api/v1/review-requests`; preview has its own endpoint.
3. The service stores a message and opaque tracking token, returning a link and optional `wa.me` URL.
4. The merchant copies the message or opens WhatsApp and sends it themselves. **The application does not send WhatsApp messages through an API.**
5. `mark-sent` records the merchant's explicit claim, not independently verified delivery; it retains the first sent time idempotently.
6. `/r/req/{token}` hashes/resolves the token, records first/last click and a tracking event, advances the contact to `LINK_CLICKED`, then issues a no-store redirect to the current `/{slug}/review`. Recognized messaging previews are excluded.

This is a simple contact/request list, not a bulk marketing platform. Some later observed statuses exist in types without production writers; do not claim a completed per-customer funnel is implemented.

Sources: `apps/web/app/api/v1/customers/`, `apps/web/app/api/v1/review-requests/`, `apps/web/app/r/req/[token]/route.ts`.

## 10. Analytics and data model

Analytics report event counts and distinct anonymous sessions, not Google review counts or star ratings. The last independently observable in-app step is opening the Google review page.

- Live queries provide range totals/funnel/unique sessions.
- Completed-day trends use rollups; today's business-local date can use live events.
- A nonempty day awaiting rollup must be shown as pending, not misleadingly as zero.
- Business timezone matters for date boundaries.
- Public events are browser-reported actions. They are useful operational telemetry, not proof of external Google behaviour.

Main schemas are in `packages/db/src/schema/`:

| File             | Major concerns                                                                   |
| ---------------- | -------------------------------------------------------------------------------- |
| `identity.ts`    | Users, durable sessions, reset/invite/MFA identity data                          |
| `business.ts`    | Business identity, slugs, links and review destinations                          |
| `qr.ts`          | Dynamic QR identity/configuration                                                |
| `ai.ts`          | Context, modes, prompt versions and generations                                  |
| `billing.ts`     | Subscriptions, payments, invoices/refunds and related lifecycle data             |
| `crm.ts`         | Customers, requests and feedback                                                 |
| `analytics.ts`   | Sessions/events/aggregate-related data                                           |
| `platform.ts`    | Platform configuration and operational records                                   |
| `maintenance.ts` | Durable maintenance/checkpoint state added by migration 0007                     |
| `domains.ts`     | Custom-domain data; schema presence is not proof of a configured domain provider |

`analytics_events` uses manually maintained PostgreSQL partition DDL. Do not accept a generated migration that turns it into an ordinary table or rewrites partition structure blindly. Use `scripts/check-migrations.mjs` and inspect SQL/snapshots together.

The event taxonomy originates from `docs/spec/11_Analytics_Event_Taxonomy.csv`; generated types and lint enforce constraints including no false review-submission terminology.

## 11. Authentication, tenancy and security boundaries

- App authentication is custom, backed by PostgreSQL. Session cookies are HttpOnly, SameSite=Lax and Secure in production; stored tokens are hashed.
- Owner session duration is normally 30 days, or 90 days with remember-me. Admin flows use shorter sessions, including pending MFA and verified admin sessions.
- `apps/web/lib/require-tenant.ts` derives a branded tenant context from the signed-in owner via `packages/core/src/tenant/guard.ts`. Do not accept a business ID from the browser as authorization.
- Tenant-owned reads/writes must include ownership in SQL predicates. Resolving an ID and filtering afterward is insufficient.
- `apps/web/lib/require-admin.ts` is separate. `SUPER_ADMIN` performs privileged mutations; support-viewer access must be explicitly permitted. Reasons/audit events protect sensitive operations.
- MFA is implemented but affected by `ADMIN_MFA_REQUIRED`. Never claim it is enforced in a live deployment without checking that configuration.
- Layouts protect rendered routes; API handlers must still enforce authentication, CSRF, tenancy and active/frozen state themselves.
- `proxy.ts` forwards a newly minted `dh_anon` cookie into request headers and sets it on the response. Anonymous sessions are business-bound; a shared cookie must not create cross-business data access.
- Preserve cryptographic secrets during migration. Do not casually rotate `HASH_PEPPER`, `SESSION_SECRET` or `APP_ENCRYPTION_KEY`; rotation can invalidate passwords/sessions or encrypted MFA material and needs a recovery plan.
- Do not log reset links, credentials, customer data or provider secrets. Development mail output may itself contain usable reset/invite links.

Privacy, contact and terms pages describe current source behaviour. They are not a substitute for owner approval of retention/refund terms or a legal review.

## 12. Email, scheduled maintenance and integrations

### Email

`apps/web/lib/mailer.ts` uses Resend REST when `RESEND_API_KEY` exists, **including in development**. Without a key, development uses console transport and production has an unconfigured-transport failure path. Never assume a local form cannot send a real email.

The owner accepted the Resend installation, but sender-DNS verification was paused. The Inception Cloudflare session did not own the parent `digitalhammerr.com` zone at that point. Do not resume or alter nameservers/DNS without explicit permission and the correct zone account. Presence of a key does not prove sender verification or email delivery.

Current public contact copy uses the previously verified official website contacts: `info@digitalhammerr.com`, `+91 99297 53194`, from `https://digitalhammerr.com/contact-us/`. No support SLA or actual delivery/call availability was verified.

### Current Vercel Cron configuration

| Endpoint                  | Schedule UTC | IST   | Purpose                                                            |
| ------------------------- | ------------ | ----- | ------------------------------------------------------------------ |
| `/api/cron/subscriptions` | Daily 00:30  | 06:00 | Subscription expiry, reminders, activity purge                     |
| `/api/cron/health`        | Daily 02:30  | 08:00 | Protected DB/Redis reachability and provider configuration checks  |
| `/api/cron/maintenance`   | Daily 03:10  | 08:40 | Analytics checkpoints/rollups, future partitions, expired sessions |

Source: `apps/web/vercel.json`. All require the configured Cron bearer secret. Do not expose health/config responses or the secret publicly.

Health's provider checks indicate configuration presence, not working Ai/payment credentials or delivered email. Maintenance depends on migration 0007, uses bounded work with durable checkpoints/transaction locks, can return complete/pending/busy, and does not drop old analytics partitions.

The standalone BullMQ worker is also implemented, but historical runbooks say it was not deployed. It requires real Redis. Avoid running both scheduling paths blindly. The web app imports `@ai-review/worker/maintenance`, not the worker startup entry.

Custom-domain polling uses `UnconfiguredCustomDomainProvider`; setting Cloudflare variables alone does not finish that integration. S3/SES/observability fields in the config likewise do not prove full upload/email/tracing implementations.

## 13. Environment configuration — names only

Source of truth: `packages/config/src/env.ts`, with `.env.example` as a template. Never replace an existing `.env` with the example wholesale.

| Area                        | Relevant names                                                                                                                                                                                           |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App/security                | `NODE_ENV`, `APP_BASE_URL`, `API_BASE_URL`, `CSRF_TRUSTED_ORIGINS`, `SESSION_COOKIE_NAME`, `SESSION_SECRET`, `APP_ENCRYPTION_KEY`, `HASH_PEPPER`, `MFA_ISSUER`, `ADMIN_MFA_REQUIRED`                     |
| Database                    | `DATABASE_URL`, `DIRECT_DATABASE_URL`, `DATABASE_POOL_MIN`, `DATABASE_POOL_MAX`, `DATABASE_SSL`, `DATABASE_SSL_ROOT_CERT`                                                                                |
| Redis/rate limits           | `REDIS_URL`, `RATE_LIMIT_MULTIPLIER`                                                                                                                                                                     |
| Ai credentials/budget       | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `AI_REQUEST_TIMEOUT_MS`                                                                                                                         |
| Ai bootstrap/legacy fields  | `AI_DEFAULT_MODEL`, `AI_REASONING_EFFORT_OVERRIDE`, `OPENAI_DEFAULT_MODEL`, `OPENAI_FALLBACK_MODEL`, `OPENAI_REASONING_EFFORT`, `AI_MAX_OUTPUT_TOKENS` — active DB prompt remains authoritative          |
| Payments                    | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `RAZORPAY_ANNUAL_PLAN_ID`; `RAZORPAY_BASE_URL` is for controlled rehearsal                                                          |
| Mail/Cron                   | `EMAIL_FROM`, `RESEND_API_KEY`, `CRON_SECRET`, `ACTIVITY_RETENTION_DAYS`                                                                                                                                 |
| Plan defaults               | `FREE_AI_GENERATION_LIMIT`, `PRO_ANNUAL_GENERATION_LIMIT`, `PRO_ANNUAL_PRICE_PAISE`, `DEFAULT_TIMEZONE`                                                                                                  |
| Storage/legacy integrations | `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PUBLIC_BASE_URL`, `SES_REGION`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ZONE_ID`, `CLOUDFLARE_SAAS_FALLBACK_ORIGIN` |
| Observability               | `SENTRY_DSN`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `LOG_LEVEL`                                                                                                                                                 |
| Seed-only                   | `SEED_OWNER_PASSWORD`, `SEED_ADMIN_PASSWORD`, `SEED_GOOGLE_REVIEW_URL`                                                                                                                                   |

Worker-specific settings include `WORKER_QUEUE_PREFIX`, concurrency/health/shutdown settings, analytics lookback/retention, partition-month/drop controls, session-purge grace days and domain-poll batch. Read the worker config rather than inventing names/defaults.

Production requires a public HTTPS `APP_BASE_URL`; `API_BASE_URL` must use the same origin and exact `/api/v1` path. CSRF aliases are explicit first-party origins, not wildcards. A localhost QR cannot work on a customer's different device. A LAN URL only works on a reachable LAN; a temporary tunnel URL is not a stable printed QR origin.

`apps/web/next.config.ts` loads the repository-root `.env` without replacing pre-existing process variables. Integration/Playwright configs also load it. Worker, seed and migration tools need their environment supplied explicitly. Restart web after environment changes; configuration is cached.

## 14. Running locally safely

Use PowerShell from the repository root. Inspect current listeners before starting duplicates. The previous session started the local DB and web server, but do not assume they survive a restart or handover.

```powershell
Set-Location 'C:\Users\digital hammerr\Downloads\reaireviewbydigitalhammerr'
git status --short
Get-NetTCPConnection -LocalPort 3000,5432 -State Listen -ErrorAction SilentlyContinue
```

For a new checkout, install with `pnpm install --frozen-lockfile`. Configure a **local/disposable** environment with private credentials supplied separately. Do not overwrite existing configuration or silently point tests at production.

Separate terminals, if these services are not already running:

```powershell
pnpm db:dev
```

```powershell
pnpm --filter @ai-review/web dev --hostname 127.0.0.1 --port 3000
```

`db:dev` starts persistent embedded PostgreSQL on port 5432, database `ai_review`, using `.pgdata/`. Existing data is reused. Do not delete `.pgdata` to fix startup. The local scripts do not start Redis. The web rate limiter has a per-process fallback; that is not equivalent to a healthy shared production limiter.

Only on a confirmed fresh/disposable local database, and after approval when data already exists, migrate and seed using an explicitly loaded environment:

```powershell
node --env-file=.env --run db:migrate
node --env-file=.env --run seed
```

Migrations are not part of an ordinary CSS/copy edit. No migration or seed was required for the latest pricing/public-page changes.

### Commands with side effects: read before running

| Command                                | Important consequence                                                                                                                |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm dev`                             | Starts web **and** worker; worker can process scheduled jobs                                                                         |
| `pnpm dev:up` / `pnpm tunnel`          | Opens a public Cloudflare quick tunnel; rewrites root `.env` base URLs; `dev:up` also manages local processes/logs and may flush DNS |
| `pnpm dev:up --restart-web`            | Still traverses DB/tunnel setup; not simply an isolated web restart                                                                  |
| `pnpm dev:down`                        | On Windows can kill port-3000 listeners and all `cloudflared.exe` processes; avoid affecting unrelated work                          |
| `pnpm seed`                            | Upserts demo data, changes demo credentials/data and can print a seed password; not harmless read-only setup                         |
| `pnpm seed --force`                    | Bypasses foreign-business protection; never use blindly or against real user data                                                    |
| `pnpm admin:create`                    | Creates/upgrades an admin and can overwrite an existing account password                                                             |
| `pnpm ai:model`                        | Changes the active DB prompt model immediately; `--show` is the read-only inspection mode                                            |
| `pnpm db:reencode`                     | Copies/swaps databases; not routine startup. `--check` inspects encoding                                                             |
| Payment reconciliation/failure scripts | Can contact Razorpay, settle payments, change statuses or activate access                                                            |
| `pnpm format`                          | Rewrites files broadly; use targeted formatting in a dirty tree                                                                      |

**Reject stale runbook advice to unset `NODE_ENV` to bypass seed protections on production.** Do not weaken a guard to perform a task that should have a reviewed production migration procedure.

## 15. Testing and honest verification

Useful commands:

```powershell
pnpm --filter @ai-review/web typecheck
pnpm --filter @ai-review/web build
pnpm test
pnpm lint
pnpm format:check
pnpm check:migrations
```

Root `pnpm build` and `pnpm typecheck` cover workspace packages. Inspect target scripts and uncommitted changes before running broad commands.

For read-only marketing/navigation browser checks, start the app first and use the exact intended hostname:

```powershell
$env:E2E_BASE_URL = 'http://127.0.0.1:3000'
pnpm exec playwright test e2e/pricing.spec.ts e2e/public-information.spec.ts --project=chrome
```

- Playwright uses the installed Chrome and does not auto-start a web server. Default base URL is localhost unless overridden.
- The mobile project currently matches only `customer-*.spec.ts`; some marketing tests explicitly set their own mobile widths in the Chrome project.
- `pnpm test:integration` loads the root environment, uses real PostgreSQL and performs fixture cleanup. Use a **disposable database**, not a production/valuable development database.
- Other E2E suites may create data or follow external destinations. Read them before execution. Do not submit real Google reviews, send WhatsApp/email, accept terms for real users, or charge/refund money without explicit approval.
- A backend health response or green build is not end-to-end proof of signup, email, payment or generation.

### Results observed before this handover

- Production web build, typecheck, targeted lint/format and `git diff --check` passed for the latest UI/public-page work.
- **16 pricing layout/navigation tests passed**, covering multiple desktop widths down to 320px.
- **22 public-information tests passed**, covering signed-out policy access, footer links, preserved signup form after legal links, separate Free/Pro pages, Back/Compare links, unchanged card dimensions, layout and console checks at 1280/390/320px.
- Earlier in the same work, **8 focused landing tests** and **63 isolated quota/generation unit tests** passed.
- The 63 tests used in-memory quota/stub providers. They do not cover the unresolved payment/renewal/refund/persistence cases below.
- During final QA, web and local PostgreSQL had stopped; they were restarted using the existing database without seeding or migration. The initial connection-refused/timeout runs were rerun successfully after recovery.
- No production deployment, live payment/refund, signup submission, outgoing support email or Google posting was performed during the latest UI verification.

Browser evidence was saved outside the repository under the machine's temporary folder, notably `ai-review-public-information-final-20260918`. These are disposable local evidence files, not portable project dependencies.

## 16. Current frontend source map

| File / folder                                             | What to change here                                                                    |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `apps/web/components/marketing/HomeMarketingPage.tsx`     | Landing section order, hero copy, mounted sections                                     |
| `apps/web/components/marketing/MarketingSite.tsx`         | Shared marketing shell, navigation/footer, benefit/CTA components                      |
| `apps/web/components/marketing/MarketingSite.module.css`  | Main landing/pricing layout and shared styling                                         |
| `apps/web/components/marketing/PricingMarketingPage.tsx`  | Compact Free/Pro cards and their Show more links                                       |
| `apps/web/components/marketing/PricingDetails.tsx`        | Plan-specific details and link renderer; details are **not mounted inside home cards** |
| `apps/web/components/marketing/PricingDetails.module.css` | Show more link and separate-page detail layout                                         |
| `apps/web/components/marketing/PublicInformationPage.tsx` | Shared themed public policy/details shell                                              |
| `apps/web/lib/public-information.ts`                      | Shared contact values and four public footer/policy links                              |
| `apps/web/app/legal/`                                     | Public policy/contact and Free/Pro plan pages                                          |
| `apps/web/components/marketing/RobotClaimBand.tsx`        | Factual robot section; no 10X/90-day result promise                                    |
| `apps/web/components/marketing/HowItWorksVideos.tsx`      | Three-step explanation clips and captions                                              |
| `apps/web/components/marketing/FaqSection.tsx`            | Six FAQs, selected screenshot/accordion behaviour                                      |
| `apps/web/public/marketing/faq/`                          | Actual product screenshot assets; retain readable resolution/aspect ratio              |
| `apps/web/components/auth/SignupForm.tsx`                 | Signup controls and policy links                                                       |
| `apps/web/components/ReviewFlow.tsx`                      | Customer interaction, auto-generation, copy/Google flow                                |

The footer's policy links are separate from the three primary marketing navigation links. The plan pages are reached from cards; there is no new footer Pricing details tab in the final approved design.

## 17. Known issues and unfinished work

These are **source-level findings or explicitly unresolved operational decisions**, not proof of a live exploit and not fixes completed by this handover. Re-check current code, reproduce safely and obtain approval before changing behaviour.

### Billing and quota — high priority before claiming launch readiness

1. **Early renewal can interrupt Pro:** `SubscriptionService.activatePro` sets the new start to the current future expiry, while quota eligibility requires the start to be at/before now. The period change also resets usage immediately. Sources: `packages/core/src/billing/subscription-service.ts`, `packages/core/src/quota/postgres-store.ts`, `packages/db/drizzle/0003_pro_quota_period_reset.sql`.
2. **Refunded-payment settlement replay:** settlement skips `CAPTURED`, not `REFUNDED`; a subsequently accepted capture/callback can mark the payment captured again and reactivate Pro. Source: `packages/core/src/billing/checkout-service.ts`, with refund state in `payment-admin-service.ts`.
3. **Failed full refund can leave access cancelled:** full refund revokes entitlement, but later refund-failure reversal restores payment state without restoring the cancelled subscription. Source: `packages/core/src/billing/payment-admin-service.ts`.
4. **Quota commit precedes persisted draft:** generation commits before the public route inserts the draft. A persistence/process failure can consume allowance without a saved/delivered draft. Sources: `packages/core/src/ai/generator.ts`, `apps/web/app/api/v1/public/review/generate/route.ts`.

### Authentication and public-flow consistency

5. Account password change commits the password before separate session revocation/rotation. On failure it can return `sessions_swept:false`, leaving prior sessions valid. Source: `apps/web/app/api/v1/account/password/route.ts`.
6. Other unexpired reset tokens can survive credential changes: forgot-password can issue multiple tokens, reset consumes only the selected one, and password/email changes do not invalidate all outstanding tokens. Re-check all token lifecycle paths before fixing.
7. Signup currently has no application rate-limiter call. The legacy `DELETE /api/v1/auth/login` only clears the cookie, unlike durable session revocation, and lacks its own CSRF check. Sources: the signup/login route handlers.
8. `/{slug}/review` currently neither restores `loadLatestDraft` nor emits `review_page_view`, unlike `/r/{code}`. Tracked-link/slug visits can regenerate on reload and undercount that funnel step.
9. Public generation currently casts JSON rather than schema-validating the complete request; `previous_generation_id` is stored as a parent reference without tenant/session ownership validation. Source: `apps/web/app/api/v1/public/review/generate/route.ts`.
10. Ai context PUT has `requireTenant` but no frozen/ACTIVE mutation guard equivalent to profile/QR writes. Source: `apps/web/app/api/v1/ai/context/route.ts`.
11. Later CRM statuses (`AI_GENERATED`, `REVIEW_COPIED`, `GOOGLE_OPENED`, `PRIVATE_FEEDBACK`) are defined, but no production status writers were found. Current automatic status updates cover preparation, manual sent marking and tracked-link clicking.
12. Existing tracked request tokens have no expiry column; the public resolver does not check a linked contact's soft deletion. Do not promise deleting a contact immediately revokes every previously sent link.

**Already fixed locally, do not list as still broken:** reset-password now claims the token, updates the password and revokes sessions within the same transaction using `SessionService(tx)`. This does not solve the separate outstanding-token issue above, and its deployment status still needs verification.

### Owner/operations decisions still pending

- Exact Pro refund window, eligibility and processing deadline. The public page says these are unconfirmed; do not invent an automatic refund or blanket no-refund rule.
- Confirm legal seller identity, address and actual tax treatment/registration. Brand/default GST config is not legal confirmation.
- Final privacy retention/deletion process and legal review. Do not promise erasure deadlines, vendor training exclusions or compliance certification unsupported by operations.
- Resume Resend sender-domain verification only with permission and correct parent-zone access.
- Verify actual production provider, price/allowance overrides, MFA setting, payment credentials/webhooks, Cron schedules, migration state, backup/restore and email delivery before launch claims.
- Maintenance migration 0007 and coupled source changes are present in the dirty tree; their live application/deployment is not verified.
- Root metadata currently has `robots: { index: false }` in `apps/web/app/layout.tsx`. This is an SEO launch decision, not something to silently remove during unrelated work.
- Domain automation is not configured merely because schema/env fields exist.
- Old media remains publicly addressable under `public/marketing` even when unmounted. Removing unsupported text from active UI is not deletion/re-encoding of every old file.

## 18. Deployment and dirty-worktree checklist

Do not deploy just because this handover mentions deployment. Ask for the intended target and permission. Confirm Inception account, Vercel linkage, root directory `apps/web`, hostname, environment and migration state. The documented Vercel region is `sin1`; do not assume account/project settings are unchanged.

For an approved deployment, read `docs/DEPLOY_VERCEL.md` critically. Its historical CLI workflow builds locally, creates a production-target deployment without moving the live domain, verifies it, then promotes it. Uploads use archive mode due to large media. Preserve Git metadata and resolve legitimate project/author access; never bypass access controls or rewrite history to get a deploy through.

App runtime should use the appropriate pooled PostgreSQL URL; migrations prefer the direct/session connection via `DIRECT_DATABASE_URL`. Do not apply migrations to a guessed database, and do not log full URLs. Confirm `.vercelignore` excludes secrets, local database, logs, dependencies and test/build output before uploading.

The worktree contains existing edits across auth, mail, CSRF/rate-limit/IP handling, marketing/FAQ/pricing/legal, dependency files, cron routes, worker stores and migrations. In particular, the maintenance implementation is a coupled set:

- `apps/web/lib/cron/maintenance*` and the maintenance Cron route;
- `apps/worker/src/maintenance.ts` and its package export/dependency wiring;
- `packages/db/src/schema/maintenance.ts` and schema index;
- `packages/db/drizzle/0007_maintenance_jobs.sql`, snapshot and migration journal.

Do not commit/deploy only one part and leave the rest behind. Conversely, do not blanket-commit unrelated user work just to include this handover.

## 19. Documentation drift and media rights

Useful history: `docs/spec/README_FIRST.md`, `docs/SPEC_AMENDMENTS.md`, `docs/DEPLOY_VERCEL.md`, `docs/DEPLOY_SUPABASE.md`, `docs/openapi/`, `docs/ASSET_LICENSE_AUDIT.md`.

Known stale areas:

- Original spec domain is `review.digitalhammerr.com`; the owner later specified `aireview.digitalhammerr.com`.
- Original English-only language and unlimited/fair-use Pro descriptions are superseded by Hinglish/English and 2,000 annual drafts.
- Original architecture mentions a separate service/container hosting; current backend uses Next.js APIs on the retained Vercel stack.
- Older docs say analytics maintenance/email are absent; current code includes Vercel maintenance/health routes and Resend support, but this does not prove they are configured live.
- Old open-item lists include work implemented later, such as atomic quota reservation and tracked-request token resolution. Verify code instead of copying an old checklist wholesale.
- Old retry comments and old first-visit anonymous-cookie comments can disagree with the current implementations.
- Old model price/economics tables are dated. Re-verify before financial/procurement decisions.

The owner explicitly confirmed commercial rights to existing robot artwork and the shopkeeper video, including voice/music, on 18 September 2026. This is owner confirmation, not independent proof that assets are open source or copyright-free. Preserve licences/notices and underlying rights records. FAQ screenshots are product examples, not customer testimonials. Google references do not imply endorsement or trademark permission.

## 20. Copy-paste brief for the next Ai

> Read AI_HANDOVER.md, apps/web/AGENTS.md and the relevant current source before changing this project. First summarize the requested change and inspect git status/diffs. Preserve the dirty worktree, existing stack and customer-controlled review idea. Ask me before changes outside my explicit request, migrations, deployment, account/provider/DNS changes, paid actions or destructive operations. Never reveal secrets or seed real user data. Keep pricing cards compact: Show more navigates to separate Free/Pro details pages, not inline expansion. Do not claim Google reviews were posted or promise guaranteed growth. Test the actual affected flow on desktop/mobile where relevant and clearly distinguish local completion from live deployment. Report blockers and remaining risks honestly.

### Suggested continuation order, subject to owner approval

1. Confirm the next requested task; do not assume every known issue here is automatically authorized.
2. Resolve refund/seller policy decisions with the owner.
3. Add safe failing tests and address billing/quota lifecycle issues before calling billing launch-ready.
4. Address auth/public-request ownership and flow consistency issues with regression tests.
5. Verify paused email/DNS and maintenance deployment only when explicitly resumed.
6. Deploy only the reviewed, approved change set to the verified intended account/project.

**Sharing this handover:** give the next Ai this file plus access to the project source. Provide secrets separately through an appropriate secure environment, never by pasting `.env` or the local database into the conversation.

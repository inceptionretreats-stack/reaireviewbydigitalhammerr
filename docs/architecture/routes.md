# Routes

This is the complete map of URLs served by `apps/web`: every page, every JSON endpoint and every
scheduled job, grouped by who uses it, with the folder under `apps/web/app` that implements it. Use it
to find the code behind a URL, or to check whether a URL already exists before adding one. The API
contract for `/api/v1` is maintained separately in [`docs/openapi`](../openapi/README.md).

## How to read the folder names

- Folders in parentheses — `(marketing)`, `(customer)`, `(auth)`, `(vendor)`, `(admin)` — are Next.js
  **route groups**. They organise code and share layouts but **do not appear in URLs**:
  `app/(vendor)/app/qr/page.tsx` serves `/app/qr`.
- `[slug]`, `[code]`, `[token]` and `[id]` are dynamic segments. A static folder beats a dynamic
  sibling, so `/legal/*`, `/r/*` and the auth pages are never captured by `/[slug]`. Business slugs
  are also checked against a reserved list (`RESERVED_SLUGS` in `packages/core/src/business/slug.ts`)
  so that a business cannot take a platform path and then find its public page hidden behind the
  static route. Add every new top-level page folder to that list. It currently misses `invite`,
  `forgot-password` and `reset-password` (see [known issues](../known-issues.md)).
- `page.tsx` renders a page; `route.ts` is an HTTP handler; `layout.tsx` wraps every page below it.
  In the API tables, the methods listed are the ones the `route.ts` file exports.

## Request pipeline: `proxy.ts`

`apps/web/proxy.ts` (the Next.js 16 replacement for `middleware.ts`) runs before every route,
matcher `/:path*`, in this order:

1. **Migration maintenance gate.** When the server variable `MIGRATION_MAINTENANCE` is exactly `1`,
   every request — pages, APIs, Server Actions, Cron, webhooks, prefetches — gets a `no-store` 503
   (HTML for page reads, JSON otherwise) with `Retry-After`. Only `GET`/`HEAD` of `/_next/static/*`
   passes. Off by default. Code: `apps/web/lib/infra/migration-maintenance.ts`.
2. **Auth-page host redirect.** A `GET`/`HEAD` for `/login`, `/signup` or `/signup/google` on the
   legacy Vercel alias host gets a 307 to the canonical production origin, which is the only origin
   authorised for Google sign-in. Customer and QR URLs stay on whichever host they were opened on.
3. **Anonymous visitor cookie.** Requests under `/api/`, `/app/`, `/admin/` and Next's own assets pass
   through untouched. Anything else without a `dh_anon` cookie gets a new random token, set as an
   HttpOnly, SameSite=Lax cookie for 30 days and also forwarded to the current request so the first
   QR page render can record its scan. See [security](security.md#anonymous-customer-session).

## Marketing — `app/(marketing)`

| URL                              | Folder                           | What it does                                                                                   |
| -------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------- |
| `/`                              | `page.tsx`                       | Landing page; sections anchored `#home`, `#how-it-works`, `#why-ai-review`, `#pricing`, `#faq` |
| `/legal/pricing`                 | `legal/pricing/`                 | Free and Pro details plus comparison table                                                     |
| `/legal/privacy`, `/legal/terms` | `legal/privacy/`, `legal/terms/` | Privacy policy, terms                                                                          |
| `/legal/cancellation-refunds`    | `legal/cancellation-refunds/`    | Cancellation and refund information                                                            |
| `/legal/contact`                 | `legal/contact/`                 | Public contact details                                                                         |

Legacy redirect stubs (permanent redirects, kept so old links keep working):

| URL                                         | Redirects to     |
| ------------------------------------------- | ---------------- |
| `/features`                                 | `/#home`         |
| `/how-it-works`                             | `/#how-it-works` |
| `/pricing`                                  | `/#pricing`      |
| `/legal/pricing/free`, `/legal/pricing/pro` | `/legal/pricing` |

Prices and draft allowances on these pages are read from `platform_settings` at render time
(`apps/web/lib/marketing/commercial-terms.ts`).

## Customer — `app/(customer)`

No login. Every page resolves the business on the server from the slug or QR code. For a disabled
QR or a suspended or unpublished business, `/r/{code}`, `/{slug}` and `/{slug}/feedback` show a
controlled "not available" page; `/{slug}/review` answers 404.

| URL                | Folder                     | What it does                                                                                      |
| ------------------ | -------------------------- | ------------------------------------------------------------------------------------------------- |
| `/r/{code}`        | `r/[code]/page.tsx`        | Printed dynamic QR. Records `qr_scan` + `review_page_view`, opens the Ai review flow              |
| `/r/req/{token}`   | `r/req/[token]/route.ts`   | Tracked review-request link. Records the click, then 302 to `/{slug}/review` (no-store)           |
| `/{slug}`          | `[slug]/page.tsx`          | Public business page: contact buttons, "Review us" (opens Google directly), private feedback link |
| `/{slug}/review`   | `[slug]/review/page.tsx`   | The same Ai review flow as `/r/{code}`, reached by link                                           |
| `/{slug}/feedback` | `[slug]/feedback/page.tsx` | Private feedback form                                                                             |

A retired slug redirects to the business's current slug for 180 days after a rename. The customer
flow is described in [customer review flow](../features/customer-review-flow.md).

## Sign-in and account screens — `app/(auth)`

| URL                | What it does                                                              |
| ------------------ | ------------------------------------------------------------------------- |
| `/signup`          | Vendor sign-up (email and password, or Google)                            |
| `/signup/google`   | Finish a Google sign-up (name, mobile, terms) or confirm password to link |
| `/login`           | Sign-in for vendors and admins                                            |
| `/login/mfa`       | Admin authenticator challenge                                             |
| `/login/mfa/enrol` | Admin authenticator enrolment                                             |
| `/forgot-password` | Request a reset link                                                      |
| `/reset-password`  | Set a new password from a reset link                                      |
| `/invite`          | Accept an admin-team invitation                                           |

## Vendor workspace — `app/(vendor)`

Both layouts redirect to `/login` without a session. The `/app` layout sends any admin role to
`/admin`; the onboarding layout sends only `SUPER_ADMIN` there. Setup:

| URL                       | What it does                                         |
| ------------------------- | ---------------------------------------------------- |
| `/onboarding`             | Resumes setup at the right step (see below)          |
| `/onboarding/business`    | Step 1: business identity and page address (slug)    |
| `/onboarding/review-link` | Step 2: Google review link                           |
| `/onboarding/links`       | Step 3: optional contact links                       |
| `/onboarding/ai`          | Step 4: optional Ai context, draft language, preview |
| `/onboarding/finish`      | Step 5: publish                                      |

`/onboarding` redirects to the first step still blocking publication (business details, then the
review link), or to the finish step when both are done or the business is past `DRAFT`
(`resumeStep` in `apps/web/lib/onboarding/steps.ts`).

Workspace screens (`app/(vendor)/app/…`; their components are in `components/dashboard/`):

| URL                               | What it does                                                                |
| --------------------------------- | --------------------------------------------------------------------------- |
| `/app`                            | Overview: setup progress, public page, live figures, subscription           |
| `/app/ai-review`                  | Ai context (services, summary, context terms), draft language, test preview |
| `/app/review-modes`               | Create, edit, archive and activate review modes                             |
| `/app/qr`                         | QR sources: create, rename, disable, download SVG/PNG cards                 |
| `/app/profile`                    | Business identity, Google review link, public-page sections                 |
| `/app/customers`                  | Customer contact list (CRM)                                                 |
| `/app/review-requests`            | Prepare WhatsApp review-request messages and tracked links                  |
| `/app/feedback`                   | Private feedback inbox                                                      |
| `/app/analytics`                  | Funnel, trend, per-QR and per-link figures                                  |
| `/app/subscription`               | Plan, usage, Pro checkout, payment history                                  |
| `/app/subscription/receipts/{id}` | Printable receipt/invoice for one payment                                   |
| `/app/settings`                   | Account, password, sessions, billing details, business status               |

## Admin console — `app/(admin)/admin`

The layout requires an admin role and, when `ADMIN_MFA_REQUIRED` is on, a session that has passed
MFA. `BUSINESS_SUPPORT_VIEWER` sees the read-only pages marked "viewer"; everything else is
`SUPER_ADMIN` only. Every API call is checked again by `requireAdmin`.

| URL                               | What it does                                            | Viewer |
| --------------------------------- | ------------------------------------------------------- | ------ |
| `/admin`                          | Platform overview figures                               | yes    |
| `/admin/businesses`               | Business list                                           | yes    |
| `/admin/businesses/{id}`          | One business: plan, usage, Ai controls, audited actions | yes    |
| `/admin/payments`                 | Payments and the webhook ledger                         | yes    |
| `/admin/payments/{id}/invoice`    | Printable invoice                                       | yes    |
| `/admin/activity`                 | User activity log                                       | yes    |
| `/admin/audit`                    | Admin audit log                                         | yes    |
| `/admin/ai`, `/admin/ai/{id}`     | Prompt versions: list, edit draft, activate, archive    | no     |
| `/admin/settings`                 | Platform settings (allowances, price, seller details)   | no     |
| `/admin/team`, `/admin/team/{id}` | Admin team, invitations, roles, MFA reset               | no     |

## JSON API — `app/api/v1`

Guards: **public** (no session; tenant resolved from slug/QR), **owner** (`requireTenant`: session,
CSRF origin check, tenant from session), **admin** (`requireAdmin`), **signature** (Razorpay HMAC).

Public:

| Endpoint                         | Methods | What it does                                   |
| -------------------------------- | ------- | ---------------------------------------------- |
| `/api/v1/public/review/generate` | POST    | Generate a customer draft (quota, rate limits) |
| `/api/v1/public/events`          | POST    | Record one taxonomy event                      |
| `/api/v1/public/feedback`        | POST    | Submit private feedback                        |

Authentication (`/api/v1/auth/*`, CSRF-checked, rate-limited where credentials are tried):

| Endpoint                            | Methods | What it does                                        |
| ----------------------------------- | ------- | --------------------------------------------------- |
| `signup`, `login`, `logout`         | POST    | Create a vendor account; sign in; sign out          |
| `forgot-password`, `reset-password` | POST    | Issue a reset link; consume it                      |
| `invite/accept`                     | POST    | Accept an admin invitation                          |
| `mfa/enrol`, `mfa/enrol/confirm`    | POST    | Start and confirm authenticator enrolment           |
| `mfa/challenge`, `mfa/recovery`     | POST    | Verify a TOTP code or a recovery code               |
| `mfa/recovery/regenerate`           | POST    | Issue new recovery codes                            |
| `google/challenge`                  | GET     | Nonce for Google Identity Services                  |
| `google`                            | POST    | Verify a Google ID token; sign in or start a flow   |
| `google/pending`                    | GET     | Display fields of a pending Google flow             |
| `google/complete`, `google/link`    | POST    | Finish a Google sign-up; link to a password account |

Owner — business and profile:

| Endpoint                              | Methods       | What it does                              |
| ------------------------------------- | ------------- | ----------------------------------------- |
| `/api/v1/business`                    | GET, PATCH    | Business identity and slug                |
| `/api/v1/business/slug-available`     | GET           | Slug availability check                   |
| `/api/v1/business/review-destination` | GET, PUT      | The Google review URL                     |
| `/api/v1/business/links`              | GET, PUT      | Public-page sections                      |
| `/api/v1/business/links/{id}`         | PATCH, DELETE | Edit or remove one section                |
| `/api/v1/business/links/reorder`      | POST          | Save section order                        |
| `/api/v1/business/publish`            | POST          | Publish: activate and create the first QR |
| `/api/v1/business/billing`            | GET, PUT      | Buyer details for GST invoices            |
| `/api/v1/qr`                          | GET, POST     | List or create QR sources                 |
| `/api/v1/qr/{id}`                     | PATCH         | Rename, disable, enable                   |
| `/api/v1/qr/{id}/download`            | GET           | Printable card, `?format=svg` or `png`    |

Owner — Ai, CRM, analytics, account, subscription:

| Endpoint                                      | Methods                  | What it does                               |
| --------------------------------------------- | ------------------------ | ------------------------------------------ |
| `/api/v1/ai/context`                          | GET, PUT                 | Services, summary, terms, draft language   |
| `/api/v1/ai/modes`, `/api/v1/ai/modes/{id}`   | GET, POST; PATCH         | List, create, edit review modes            |
| `/api/v1/ai/modes/{id}/activate`              | POST                     | Make a mode the active one                 |
| `/api/v1/ai/test-preview`                     | POST                     | Owner preview draft (no quota)             |
| `/api/v1/customers`, `/api/v1/customers/{id}` | GET, POST; PATCH, DELETE | Contact list; delete is soft               |
| `/api/v1/review-requests`                     | POST                     | Prepare a message and tracked link         |
| `/api/v1/review-requests/preview`             | POST                     | Render a message without saving            |
| `/api/v1/review-requests/{id}/mark-sent`      | POST                     | Record the owner's "I sent it"             |
| `/api/v1/feedback`, `/api/v1/feedback/{id}`   | GET; PATCH               | Inbox list; mark read or archive           |
| `/api/v1/analytics/overview`, `qr`, `links`   | GET                      | KPI/funnel/trend, per-QR, per-link figures |
| `/api/v1/account`                             | PATCH                    | Name, email, mobile                        |
| `/api/v1/account/password`                    | POST                     | Change password, sign out other sessions   |
| `/api/v1/account/sessions/revoke-others`      | POST                     | Sign out every other session               |
| `/api/v1/subscription`                        | GET                      | Plan, usage, payment history               |
| `/api/v1/subscription/checkout`               | POST                     | Create a Razorpay order                    |
| `/api/v1/subscription/verify`                 | POST                     | Verify the Checkout.js callback            |

Admin (`/api/v1/admin/*`):

| Endpoint                                         | Methods                  | What it does                                                                                                          |
| ------------------------------------------------ | ------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `overview`, `activity`, `audit-logs`             | GET                      | Figures and logs                                                                                                      |
| `businesses`, `businesses/{id}`                  | GET; GET, PATCH          | List; detail; action-based mutations (grant or revoke Pro, quota, suspend, Ai suspend/throttle, warn, password reset) |
| `payments`, `payments/{id}`, `payments/webhooks` | GET                      | Payments and webhook ledger                                                                                           |
| `payments/{id}/actions`                          | POST                     | `reconcile`, `mark_failed`, `resend_receipt`                                                                          |
| `payments/{id}/refund`                           | POST                     | Refund through Razorpay (MFA step-up)                                                                                 |
| `ai/prompt-versions`, `ai/prompt-versions/{id}`  | GET, POST; GET, PATCH    | List, create draft, read, edit draft                                                                                  |
| `ai/prompt-versions/{id}/activate`, `…/archive`  | POST                     | Activate (archives the current) or archive                                                                            |
| `settings`                                       | GET, PATCH               | Platform settings                                                                                                     |
| `team`, `team/{id}`, `team/invites/{id}`         | GET, POST; PATCH; DELETE | Invite, change role, disable, withdraw invite                                                                         |
| `team/{id}/mfa/reset`                            | POST                     | Clear another admin's authenticator                                                                                   |

Webhooks: `POST /api/v1/webhooks/razorpay` — no session or CSRF; the body is verified against the
`X-Razorpay-Signature` HMAC. See [billing and plans](../features/billing-and-plans.md).

## Scheduled jobs (Vercel Cron)

Declared in `apps/web/vercel.json`, handled in `app/api/cron/*`, all `GET` and all requiring
`Authorization: Bearer <CRON_SECRET>` (401 when wrong, 503 when the secret is unset). Each runs once
a day; the schedule table is in
[email and scheduled jobs](../operations/email-and-scheduled-jobs.md#vercel-cron-jobs).

| Endpoint                  | What it does                                                                        |
| ------------------------- | ----------------------------------------------------------------------------------- |
| `/api/cron/subscriptions` | Expire lapsed Pro years, queue and send renewal reminders, purge old activity rows  |
| `/api/cron/health`        | Database/Redis reachability and provider-configuration check (no secrets returned)  |
| `/api/cron/maintenance`   | Ensure future analytics partitions, purge expired login sessions, analytics rollups |

Details: [data model](data-model.md#scheduled-maintenance).

## Where the code lives

| What                      | Path                                                                                      |
| ------------------------- | ----------------------------------------------------------------------------------------- |
| Request proxy             | `apps/web/proxy.ts`                                                                       |
| Maintenance gate          | `apps/web/lib/infra/migration-maintenance.ts`                                             |
| Page and API routes       | `apps/web/app/`                                                                           |
| Vendor and admin layouts  | `apps/web/app/(vendor)/app/layout.tsx`, `apps/web/app/(admin)/admin/layout.tsx`           |
| Owner and admin guards    | `apps/web/lib/tenant/require-tenant.ts`, `apps/web/lib/auth/require-admin.ts`             |
| Public slug/QR resolution | `apps/web/lib/customer/public-business.ts`, `apps/web/lib/customer/resolve-public-ref.ts` |
| Reserved slugs            | `packages/core/src/business/slug.ts`                                                      |
| Cron schedule and auth    | `apps/web/vercel.json`, `apps/web/lib/cron/auth.ts`                                       |
| Vendor navigation         | `apps/web/components/dashboard/shell/nav-items.ts`                                        |
| Vendor screen components  | `apps/web/components/dashboard/<screen>/`                                                 |
| Admin navigation          | `apps/web/components/admin/shell/AdminNav.tsx`                                            |
| Admin screen components   | `apps/web/components/admin/<screen>/` (`businesses`, `payments`, `team`, `activity`, …)   |
| API contract              | `docs/openapi/v1.yaml`                                                                    |

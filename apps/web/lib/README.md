# `lib/` — web-app logic

`lib/` holds the logic that more than one route, page or component needs: guards, sessions,
database queries, request parsing, view models, email, QR rendering, and the wiring that builds
`@ai-review/core` services with this app's database and environment. Read this to find where a piece
of behaviour lives, to name a new module, and to check whether a module is safe to import from a
client component.

Code used by only one page or endpoint may stay in that route file (see
[`app/README.md`](../app/README.md#rules-for-route-files)); move it here once a second place needs
it. Domain logic that the worker also needs belongs in `packages/core`, not here.

> **Two words to read carefully.** **"Customer"** in `customer/` means the anonymous person who
> scans the QR code. A business's own contact list (its CRM at `/app/customers`) is `crm/customers/`.
> **"Dashboard"** in `dashboard/` is narrower than in `components/dashboard/` (the whole vendor
> workspace): here it is only the `/app` overview loader and the shared status, money and date
> formatting. See the [glossary](../../../docs/glossary.md).

## Folders

| Folder                 | What it holds                                                                                                                                                                                                                                                                  | Key files                                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `infra/`               | Process-wide plumbing: validated environment, the database pool, error logging that never leaks SQL or secrets, backend health probes, the migration-maintenance gate used by `proxy.ts`.                                                                                      | `env.ts`, `db.ts`, `safe-error.ts`, `backend-health.ts`, `migration-maintenance.ts`               |
| `http/`                | Helpers for route handlers: the API error envelope, safe JSON body reading, the CSRF origin check, the rate limiter (Redis with in-memory fallback) and the trusted client IP (`clientIp`, in `rate-limit.ts`).                                                                | `api-error.ts`, `request-body.ts`, `csrf.ts`, `rate-limit.ts`                                     |
| `auth/`                | Session cookie and lookup, the Argon2 password hasher, Google sign-in, admin MFA, and the admin route guard.                                                                                                                                                                   | `session.ts`, `password-hasher.ts`, `google-auth.ts`, `mfa.ts`, `require-admin.ts`                |
| `tenant/`              | The owner route guard (resolves the business from the session, checks CSRF) and the rules for the placeholder "shell" business created at signup.                                                                                                                              | `require-tenant.ts`, `tenant-shell.ts`                                                            |
| `onboarding/`          | The five-step wizard contract (order, paths, titles) and progress derived from the stored business.                                                                                                                                                                            | `steps.ts`, `progress.ts`                                                                         |
| `activity/`            | Records one activity-log row per signed-in action, after the response is sent.                                                                                                                                                                                                 | `recorder.ts`                                                                                     |
| `customer/`            | The anonymous public flow: resolving a QR code or slug to a published business, the anonymous visitor session, and the service list a customer picks from.                                                                                                                     | `resolve-public-ref.ts`, `public-business.ts`, `anonymous-session.ts`, `customer-services.ts`     |
| `ai/`                  | Assembles a draft generation from stored configuration (prompt version, mode, business context, quota, provider), and the draft-language options.                                                                                                                              | `generation-service.ts`, `draft-language.ts`                                                      |
| `ai/modes/`            | Review-mode storage, request parsing and guards for the review-mode endpoints.                                                                                                                                                                                                 | `mode-service.ts`, `schema.ts`, `guards.ts`                                                       |
| `qr/`                  | QR encoder settings, the printable QR card (PNG and SVG, with text outlined from bundled Inter), and the request parsing and wire shape of the QR source endpoints.                                                                                                            | `qr-image.ts`, `qr-card.ts`, `qr-card-text.ts`, `qr-source-api.ts`                                |
| `email/`               | The mail transport (Resend; console output in development when no key is set) and every email's text and HTML.                                                                                                                                                                 | `mailer.ts`, `email-templates.ts`                                                                 |
| `billing/`             | The subscription view shared by the subscription page and API, Razorpay client configuration, the invoice view model, and the receipt email.                                                                                                                                   | `subscription.ts`, `invoice-view.ts`, `receipt-mail.ts`                                           |
| `marketing/`           | What the public pages show: price and draft allowances from `platform_settings`, the development-only live demo tenant, public contact details and policy links.                                                                                                               | `commercial-terms.ts`, `landing-demo.ts`, `public-information.ts`                                 |
| `account/`             | Owner account settings: field limits and body parsing, the settings loader, and the live session count.                                                                                                                                                                        | `schema.ts`, `settings.ts`, `session-count.ts`                                                    |
| `crm/customers/`       | The business's own contact list: tenant-scoped queries, request bodies, search and paging parameters, and which statuses an owner may set by hand.                                                                                                                             | `repository.ts`, `body.ts`, `list-params.ts`, `customer-status.ts`                                |
| `crm/review-requests/` | Manual review-request messages: database reads and writes (owner-side ones scoped to the tenant, plus the tracked-link lookup by token hash), compose-body parsing, the message template, the customer-status ladder, and link-preview bot detection for tracked links.        | `repository.ts`, `compose-request.ts`, `template.ts`, `customer-journey.ts`, `link-preview.ts`    |
| `analytics/`           | The analytics screen and API: reporting queries, pure metric derivation (funnel, trend), business-local date ranges, and the `?from=&to=` parsing shared by the three analytics endpoints.                                                                                     | `queries.ts`, `metrics.ts`, `range.ts`, `range-request.ts`                                        |
| `feedback/`            | The private feedback inbox: page loader, filters and paging, and the row shape shared by the API and the screen.                                                                                                                                                               | `inbox.ts`, `filters.ts`, `row.ts`                                                                |
| `profile/`             | Public profile sections (link types, targets, labels) and reorder arithmetic, shared by the profile editor and the links endpoints.                                                                                                                                            | `sections.ts`, `order.ts`                                                                         |
| `dashboard/`           | `summary.ts` loads the vendor workspace's `/app` overview. `presentation.ts` maps database states to labels and badges and holds `formatMoney` and `formatDate`, which the vendor screens, the invoice, the receipt email, the daily cron and the admin payments page all use. | `summary.ts`, `presentation.ts`                                                                   |
| `admin/`               | Admin console reads and actions: business list, detail and overview figures; one loader per tab of the admin business page; payments, team, prompt versions, activity filter, abuse alerts, owner emails, platform-timezone dates.                                             | `businesses.ts`, `business-tab-loaders.ts`, `payments.ts`, `team.ts`, `owner-actions.ts`          |
| `cron/`                | Vercel Cron work: the bearer-token check, the daily subscription sweep, and the checkpointed maintenance run (loop in `maintenance.ts`, Postgres store built on `@ai-review/worker/maintenance` in `maintenance-store.ts`, request handling in `maintenance-handler.ts`).      | `auth.ts`, `subscriptions.ts`, `maintenance.ts`, `maintenance-store.ts`, `maintenance-handler.ts` |

`qr/qr-card-fonts.generated.ts` is generated by `scripts/codegen/generate-qr-card-fonts.mjs` from
`assets/fonts/`. Do not edit it by hand.

## What a file name tells you

File names follow these roles. Use the same names for a new module, so a reader can tell from the
name whether it touches the database or parses a request.

| Name                                   | Role                                                                                                          | Examples                                                                                                               |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `repository.ts`                        | Database reads and writes for one concern. Owner-side functions take the tenant id resolved from the session. | `crm/customers/repository.ts`, `crm/review-requests/repository.ts`                                                     |
| `queries.ts`                           | Read-only reporting SQL.                                                                                      | `analytics/queries.ts`                                                                                                 |
| `*-service.ts`                         | Server work that builds on `@ai-review/core` or owns one table's rules.                                       | `ai/generation-service.ts`, `ai/modes/mode-service.ts`                                                                 |
| Page loaders (functions named `load…`) | Everything one screen needs, in one server call. The file name varies.                                        | `dashboard/summary.ts`, `feedback/inbox.ts`, `account/settings.ts`, `admin/business-tab-loaders.ts`                    |
| `body.ts`, `*-request.ts`, `*-api.ts`  | Parsing and validating a request body or its query range; `*-api.ts` also defines the reply.                  | `crm/customers/body.ts`, `crm/review-requests/compose-request.ts`, `analytics/range-request.ts`, `qr/qr-source-api.ts` |
| `list-params.ts`, `filters.ts`         | Query-string parsing: search, filters and paging.                                                             | `crm/customers/list-params.ts`, `feedback/filters.ts`                                                                  |
| `schema.ts`                            | Client-safe field limits and parsers shared by a form and its endpoint.                                       | `account/schema.ts`, `ai/modes/schema.ts`                                                                              |
| `presentation.ts`                      | Labels, badges and display formatting.                                                                        | `dashboard/presentation.ts`                                                                                            |
| `require-*.ts`, `guards.ts`            | Route guards that return an error response or the resolved caller.                                            | `tenant/require-tenant.ts`, `auth/require-admin.ts`, `ai/modes/guards.ts`                                              |
| `*.generated.ts`                       | Generated output. Never edit by hand.                                                                         | `qr/qr-card-fonts.generated.ts`                                                                                        |

## Server-only and client-safe modules

Most of `lib/` is **server-only**: it imports the database (`@/lib/infra/db`), the environment
(`@/lib/infra/env`), `next/headers`, Node built-ins, `sharp`, `ioredis`, or runtime values from
`@ai-review/core` or `@ai-review/db`. Importing any of these into a client component would pull
server code and secrets toward the browser. There is no `server-only` package guard and no lint rule
for this boundary, so it is kept by convention and review.

These modules are **client-safe** — no server-only imports — and client components import values from
them today:

| Module                                    | Used by (client)                                                                           |
| ----------------------------------------- | ------------------------------------------------------------------------------------------ |
| `customer/customer-services.ts`           | Customer review flow and service picker                                                    |
| `ai/draft-language.ts`                    | Ai settings screen and onboarding Ai step                                                  |
| `ai/modes/schema.ts`                      | Review-mode editor                                                                         |
| `account/schema.ts`                       | Account details and password forms                                                         |
| `analytics/range.ts`                      | Analytics date-range filter                                                                |
| `crm/customers/customer-status.ts`        | Customer form dialog                                                                       |
| `crm/review-requests/template.ts`         | Review-request composer                                                                    |
| `dashboard/presentation.ts`               | Subscription panel, and the QR screen through `components/dashboard/qr/qr-screen-model.ts` |
| `feedback/filters.ts`, `feedback/row.ts`  | Feedback inbox and its filter form                                                         |
| `onboarding/steps.ts`                     | Onboarding wizard shell and finish step                                                    |
| `profile/sections.ts`, `profile/order.ts` | Profile editor                                                                             |
| `tenant/tenant-shell.ts`                  | Onboarding finish step (through `components/onboarding/finish-preview.ts`)                 |

Also free of server-only imports, but used only by server code at present: `analytics/metrics.ts`,
`billing/invoice-view.ts`, `crm/customers/list-params.ts`, `crm/review-requests/customer-journey.ts`,
`crm/review-requests/link-preview.ts`, `cron/maintenance.ts`, `email/email-templates.ts`,
`infra/safe-error.ts`, `marketing/public-information.ts` and `qr/qr-source-api.ts`.

A client component may still use a **type** from a server-only module (`import type` is erased at
build time) — for example `CustomerDto` from `crm/customers/repository.ts` or `WireMode` from
`ai/modes/mode-service.ts`. If you make a module client-safe, say so in its header comment, and keep
its imports to other client-safe modules, `@ai-review/contracts`, `@ai-review/analytics` and
type-only imports.

## Import rules

- **`lib/` never imports from `components/` or `app/`.** ESLint enforces this: the rule in
  `eslint.config.mjs` fails `pnpm lint` on any such import from a non-test file in `lib/`. Tests are
  exempt, and one uses that on purpose: `qr/__tests__/qr-source-api.test.ts` imports
  `components/dashboard/qr/qr-screen-model.ts` to prove the dialog and the endpoint enforce the same
  limits. (A matching rule stops `components/` importing `app/`.)
- **Between concern folders, always use `@/lib/<folder>/<module>`**, for example
  `@/lib/infra/env`. Same-folder imports use `./`, and a test imports its module as `../module`.
- Workspace packages are imported as `@ai-review/<name>`.

## Tests

Unit tests live in `__tests__/` inside the folder they cover (for example
`crm/customers/__tests__/list-params.test.ts`) and run with `pnpm test` from the repository root.
Most are named after the module they test. These are not:

| Test file                                                | What it tests                                             |
| -------------------------------------------------------- | --------------------------------------------------------- |
| `http/__tests__/client-ip.test.ts`                       | `clientIp` in `http/rate-limit.ts`                        |
| `http/__tests__/csrf-dev.test.ts`                        | `http/csrf.ts` with development settings (local origins)  |
| `auth/__tests__/next-path.test.ts`                       | `nextPathAfterLogin` in `auth/session.ts`                 |
| `crm/review-requests/__tests__/repository-scope.test.ts` | The tenant scoping in `crm/review-requests/repository.ts` |
| `cron/__tests__/maintenance.test.ts`                     | `cron/maintenance.ts` and `cron/maintenance-handler.ts`   |
| `infra/__tests__/migration-maintenance.test.ts`          | `apps/web/proxy.ts`, including the maintenance gate       |

Tests that need a real PostgreSQL go in `__tests__/integration/` — currently
`cron/__tests__/integration/maintenance.test.ts`, which runs `cron/maintenance.ts` against the
store in `cron/maintenance-store.ts` — and run with `pnpm test:integration`.

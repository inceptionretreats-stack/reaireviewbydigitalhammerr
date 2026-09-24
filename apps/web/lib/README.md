# `lib/` — web-app logic

`lib/` holds the logic behind the routes in `app/`: guards, sessions, database queries, request
parsing, view models, email, QR rendering, and the wiring that builds `@ai-review/core` services with
this app's database and environment. Read this to find where a piece of behaviour lives, and to check
whether a module is safe to import from a client component.

Domain logic that the worker also needs belongs in `packages/core`, not here.

## Folders

| Folder                   | What it holds                                                                                                                                                                             | Key files                                                             |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `infra/`                 | Process-wide plumbing: validated environment, the database pool, error logging that never leaks SQL or secrets, backend health probes, the migration-maintenance gate used by `proxy.ts`. | `env.ts`, `db.ts`, `safe-error.ts`                                    |
| `http/`                  | Helpers for route handlers: the API error envelope, safe JSON body reading, the CSRF origin check, the rate limiter (Redis with in-memory fallback) and client IP.                        | `api-error.ts`, `request-body.ts`, `rate-limit.ts`                    |
| `auth/`                  | Session cookie and lookup, the Argon2 password hasher, Google sign-in, admin MFA, and the admin route guard.                                                                              | `session.ts`, `require-admin.ts`, `google-auth.ts`                    |
| `tenant/`                | The owner route guard (resolves the business from the session, checks CSRF) and the rules for the placeholder "shell" business created at signup.                                         | `require-tenant.ts`, `tenant-shell.ts`                                |
| `onboarding/`            | The five-step wizard contract (order, paths, titles) and progress derived from the stored business.                                                                                       | `steps.ts`, `progress.ts`                                             |
| `activity/`              | Records one activity-log row per signed-in action, after the response is sent.                                                                                                            | `recorder.ts`                                                         |
| `customer/`              | The public side: resolving a QR code or slug to a published business, the anonymous visitor session, and the service list a customer picks from.                                          | `resolve-public-ref.ts`, `public-business.ts`, `anonymous-session.ts` |
| `ai/`                    | Assembles a draft generation from stored configuration (prompt version, mode, business context, quota, provider), and the draft-language setting.                                         | `generation-service.ts`, `draft-language.ts`                          |
| `ai/modes/`              | Review-mode storage, request parsing and guards for the review-mode endpoints.                                                                                                            | `mode-service.ts`, `schema.ts`, `guards.ts`                           |
| `qr/`                    | QR encoder settings, the printable QR card (PNG and SVG, with text outlined from bundled Inter), and request parsing for QR sources.                                                      | `qr-image.ts`, `qr-card.ts`, `qr-source.ts`                           |
| `email/`                 | The mail transport (Resend; console output in development when no key is set) and every email's text and HTML.                                                                            | `mailer.ts`, `email-templates.ts`                                     |
| `billing/`               | The subscription view shared by the subscription page and API, Razorpay client configuration, the invoice view model, and the receipt email.                                              | `subscription.ts`, `invoice-view.ts`, `receipt-mail.ts`               |
| `marketing/`             | What the public pages show: price and draft allowances from `platform_settings`, the development-only live demo tenant, public contact details and policy links.                          | `commercial-terms.ts`, `landing-demo.ts`, `public-information.ts`     |
| `account/`               | Owner account settings: field limits, the settings loader, and the live session count.                                                                                                    | `schema.ts`, `settings.ts`, `session-count.ts`                        |
| `crm/customers/`         | The business's own contact list: tenant-scoped queries, request bodies, search and paging, and which statuses an owner may set by hand.                                                   | `repository.ts`, `body.ts`, `customer-status.ts`                      |
| `crm/review-requests/`   | Manual review-request messages: queries, the message template, the customer-status ladder, and link-preview bot detection for tracked links.                                              | `service.ts`, `template.ts`, `link-preview.ts`                        |
| `analytics/`             | The analytics screen and API: queries, pure metric derivation (funnel, trend), business-local date ranges.                                                                                | `queries.ts`, `metrics.ts`, `range.ts`                                |
| `feedback/`              | The private feedback inbox: page loader, filters and paging, and the row shape shared by the API and the screen.                                                                          | `inbox.ts`, `filters.ts`, `row.ts`                                    |
| `profile/`               | Public profile sections (link types, targets, labels) and reorder arithmetic, shared by the profile editor and the links endpoints.                                                       | `sections.ts`, `order.ts`                                             |
| `dashboard/`             | The overview screen's data loader and the mapping from database states to dashboard labels and badges.                                                                                    | `summary.ts`, `presentation.ts`                                       |
| `admin/`                 | Admin console reads and actions: business list, payments, team, prompt versions, activity filter, abuse alerts, owner emails, platform-timezone dates.                                    | `businesses.ts`, `payments.ts`, `team.ts`                             |
| `admin/business-detail/` | One loader per tab of the admin business page.                                                                                                                                            | `loaders.ts`                                                          |
| `cron/`                  | Vercel Cron work: the bearer-token check, the daily subscription sweep, and the checkpointed maintenance run built on `@ai-review/worker/maintenance`.                                    | `auth.ts`, `subscriptions.ts`, `maintenance.ts`                       |

`qr/qr-card-fonts.generated.ts` is generated by `scripts/codegen/generate-qr-card-fonts.mjs` from
`assets/fonts/`. Do not edit it by hand.

## Server-only and client-safe modules

Most of `lib/` is **server-only**: it imports the database (`@/lib/infra/db`), the environment
(`@/lib/infra/env`), `next/headers`, Node built-ins, `sharp`, `ioredis`, or runtime values from
`@ai-review/core` or `@ai-review/db`. Importing any of these into a client component would pull
server code and secrets toward the browser. There is no `server-only` package guard, so the boundary
is kept by convention and review.

These modules are **client-safe** — no server-only imports — and client components import values from
them today:

| Module                                    | Used by (client)                                 |
| ----------------------------------------- | ------------------------------------------------ |
| `customer/customer-services.ts`           | Customer review flow and service picker          |
| `ai/draft-language.ts`                    | Ai settings screen and onboarding Ai step        |
| `ai/modes/schema.ts`                      | Review-mode editor                               |
| `account/schema.ts`                       | Settings forms                                   |
| `analytics/range.ts`                      | Analytics date-range filter                      |
| `crm/customers/customer-status.ts`        | Customer form dialog                             |
| `crm/review-requests/template.ts`         | Review-request composer                          |
| `dashboard/presentation.ts`               | Subscription panel                               |
| `feedback/filters.ts`, `feedback/row.ts`  | Feedback inbox                                   |
| `onboarding/steps.ts`                     | Onboarding wizard shell and finish step          |
| `profile/sections.ts`, `profile/order.ts` | Profile editor                                   |
| `tenant/tenant-shell.ts`                  | Onboarding finish step (via `finish-preview.ts`) |

Also free of server-only imports, but used only by server code at present: `analytics/metrics.ts`,
`crm/customers/query.ts`, `crm/review-requests/customer-journey.ts`,
`crm/review-requests/link-preview.ts`, `qr/qr-source.ts` and `cron/maintenance.ts`.

A client component may still use a **type** from a server-only module (`import type` is erased at
build time) — for example `CustomerDto` from `crm/customers/repository.ts` or `WireMode` from
`ai/modes/mode-service.ts`. If you make a module client-safe, say so in its header comment, and keep
its imports to other client-safe modules, `@ai-review/contracts`, `@ai-review/analytics` and
type-only imports.

## Import rules

- `lib/` never imports from `components/` or `app/`. (One test,
  `qr/__tests__/qr-source.test.ts`, imports `components/dashboard/qr/qr-sources.ts` on purpose, to
  prove the dialog and the endpoint enforce the same limits.)
- Between concern folders, use `@/lib/<folder>/<module>`. Some older modules use relative paths
  such as `../infra/env`; both resolve to the same file.
- Workspace packages are imported as `@ai-review/<name>`.

## Tests

Unit tests live in `__tests__/` inside the folder they cover (for example
`crm/customers/__tests__/query.test.ts`) and run with `pnpm test` from the repository root. Tests
that need a real PostgreSQL go in `__tests__/integration/` — currently
`cron/__tests__/integration/maintenance.test.ts` — and run with `pnpm test:integration`.

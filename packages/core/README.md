# @ai-review/core — domain logic

This package holds the business rules that do not depend on HTTP or React: Ai draft generation
and prompts, quota, billing and Razorpay, authentication primitives, tenancy, audit, abuse
controls, QR codes and rate limiting. Read it before changing any of those rules. Route handlers
in `apps/web` stay thin and call into this package; the worker and the operator scripts use it
too, so there is one implementation.

## Public entry

`package.json` exports only `"."`, which is `src/index.ts`: a barrel that re-exports every module
below. Import from `@ai-review/core`, never from a file path. Because the barrel pulls in
`@ai-review/db` (and so `pg`) and `@node-rs/argon2`, browser code may only `import type` from it.

Runtime dependencies: `@ai-review/db`, `drizzle-orm`, `@node-rs/argon2`, `@anthropic-ai/sdk`.

## Modules

One row per folder in `src/`; the larger folders are broken down below the table.

| Folder        | Owns                                                                                 |
| ------------- | ------------------------------------------------------------------------------------ |
| `ai/`         | Ai draft generation: prompts, prompt versions, provider adapters, quality gates      |
| `auth/`       | Passwords, tokens, sessions, admin MFA, the admin team                               |
| `billing/`    | Razorpay checkout, entitlements, expiry and reminders, refunds, invoices and GST     |
| `business/`   | Slugs, Google review-link validation, phone normalisation                            |
| `quota/`      | Draft allowance: reserve before the provider call, then commit or release            |
| `rate-limit/` | Named limit policies and their Redis and in-memory stores                            |
| `abuse/`      | Abuse signals (four thresholds computed on read) and the admin responses to them     |
| `activity/`   | The closed list of user-activity actions and the recorder for `user_activity_logs`   |
| `audit/`      | `AuditWriter` for `admin_audit_logs`; high-risk actions must carry a reason          |
| `crypto/`     | `SecretBox`: AES-256-GCM sealing under `APP_ENCRYPTION_KEY` (admin TOTP seeds)       |
| `platform/`   | `PlatformSettingsService`: reads and writes `platform_settings`, audited             |
| `qr/`         | Opaque dynamic QR codes: generate, validate format, `buildQrUrl`                     |
| `tenant/`     | `TenantGuard` and the branded `ResolvedTenant` type for every private business query |

`src/db-executor.ts` defines `Executor` (the pool or a transaction handle). Services take it so an
audit row commits or rolls back together with the change it describes.

**`ai/`**

- `prompt-builder.ts` builds the model input from business context and the services the customer
  picked; `guidance.ts` holds the writing rules, stored on the prompt version as data.
- `prompt-version-service.ts` manages prompt versions (DRAFT, ACTIVE, ARCHIVED; activating an
  archived one is a rollback).
- `provider.ts` defines the adapter interface and `StubAiProvider`; `openai-provider.ts`,
  `anthropic-provider.ts` and `gemini-provider.ts` are the real adapters.
- `generator.ts` orchestrates one draft: reserve quota, call the provider, run the output and
  similarity checks (`similarity.ts`), then commit or release. `structured-review.ts` validates
  provider output; `draft-language.ts` lists the draft languages.
- Which provider is used is decided in `apps/web/lib/ai/generation-service.ts`, not here.

**`auth/`**

- `password.ts` (Argon2id with `HASH_PEPPER`), `tokens.ts` (random tokens; only the SHA-256 is
  stored), `session.ts` (durable session rows; short-lived admin sessions until MFA passes),
  `totp.ts`.
- `mfa-service.ts`: admin authenticator enrolment, challenge and recovery codes.
- `team-service.ts`: the admin team (see below).

**`billing/`**

- `razorpay.ts`: order creation and checkout/webhook signature checks.
- `checkout-service.ts`: the paid path onto Pro; the browser callback and the webhook both settle
  through one idempotent path.
- `subscription-service.ts`: every write to a business's entitlement (payment or admin grant).
- `lifecycle-service.ts`: expiring lapsed years and queueing renewal reminders.
- `payment-admin-service.ts`: admin payment views, refunds, reconcile and mark-failed.
- `invoice-service.ts` and `gst.ts`: invoice numbering, invoice snapshots and the GST split.

**`business/`**: `slug.ts` (rules, reserved words), `slug-service.ts` (the single
`business_slugs` namespace, with old slugs kept as redirects), `review-url.ts` (Google review-link
validation), `phone.ts` (E.164, India-first).

## Two things that surprise newcomers

- **The admin team lives in `auth/team-service.ts`.** Inviting admins, changing roles
  (`SUPER_ADMIN`, `BUSINESS_SUPPORT_VIEWER`), disabling and re-enabling accounts are all there,
  not in an `admin/` folder.
- **Generic admin-audit helpers live in `billing/subscription-service.ts`.** `AdminActor`,
  `SYSTEM_ACTOR`, `auditActorType()` and the `AdminAction` shape are defined there and imported by
  `auth/team-service.ts`, `auth/mfa-service.ts` and `abuse/service.ts`, even though they have
  nothing to do with billing.

## Tests

- Co-located unit tests in `src/<module>/__tests__/` (for example `ai/__tests__`,
  `rate-limit/__tests__`, `quota/__tests__`).
- Cross-module unit tests in `src/__tests__/` (generation, QR and AI, Razorpay, audit writer).
- Integration tests in `src/__tests__/integration/` (quota concurrency, checkout, lifecycle,
  payments, subscriptions, MFA, team, activity, abuse, slugs, prompt versions). They need a real
  PostgreSQL at `DATABASE_URL`; run them with `pnpm test:integration` against a disposable
  database.

Unit tests run with `pnpm test` and use the in-memory stores and `StubAiProvider`.

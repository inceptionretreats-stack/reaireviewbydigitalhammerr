# Environment variables

Every environment variable the code reads or validates, by name and purpose, and which ones must be
set. This page never lists values: real values live in the root `.env` on a developer machine and
in the Vercel project settings for deployments, and are never committed or pasted into chat. Read
it when configuring a machine or a deployment, or before adding a variable.

## Where configuration comes from

- **The schema:** `packages/config/src/env.ts` validates the environment once per process and
  refuses to start with a list of every problem. The web app (`apps/web/lib/infra/env.ts`) and the
  worker (`apps/worker/src/config.ts`) both use it. A few variables are read directly by one module
  and are not in the schema; they are marked below.
- **The template:** `.env.example` at the repository root lists the schema's variables with
  comments. Copy it only when there is no `.env`; never replace an existing `.env` with it.
- **Locally:** one `.env` at the repository root. The web app, the integration-test config and the
  Playwright config load it without overriding variables already set in the shell. Some scripts do
  not load it; see [local development](local-development.md#first-time-setup).
- **Deployed:** the Vercel project's environment variables. Changing them requires the owner's
  approval and a redeploy.
- The web server caches the validated environment for the life of the process. Restart it after a
  change.

## Required to boot

The schema rejects a start without these (in any environment):

| Name                 | Rule                                                                                |
| -------------------- | ----------------------------------------------------------------------------------- |
| `APP_BASE_URL`       | An HTTP(S) origin with no path. Every QR code and emailed link is built from it     |
| `API_BASE_URL`       | Same origin as `APP_BASE_URL`, path exactly `/api/v1`                               |
| `SESSION_SECRET`     | At least 16 characters, not a `CHANGE_ME` placeholder                               |
| `APP_ENCRYPTION_KEY` | At least 32 characters                                                              |
| `HASH_PEPPER`        | At least 16 characters                                                              |
| `DATABASE_URL`       | Starts with `postgres`                                                              |
| `REDIS_URL`          | Starts with `redis`                                                                 |
| `EMAIL_FROM`         | A valid email address                                                               |
| `S3_BUCKET`          | Any non-empty value. Required by the schema although nothing reads it (see Storage) |

Additional rules when `NODE_ENV` is `production`:

- at least one of `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY` (otherwise the stub
  provider would serve canned drafts to real customers);
- `CRON_SECRET`;
- `APP_BASE_URL` must be HTTPS on a publicly reachable host (a printed QR embeds it permanently);
- every `CSRF_TRUSTED_ORIGINS` entry must be HTTPS on a public host.

## All variables by purpose

"Optional" means the schema accepts it missing, usually with a default in code. "Not read" means
the schema validates it but no application code uses it today; setting it changes nothing.

### Application and security

| Name                   | Required | Purpose                                                                                                                     |
| ---------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`             | Optional | `development`, `test` or `production`. Production enables the stricter rules above and the seed refuses to run              |
| `APP_BASE_URL`         | Yes      | Canonical public origin; QR payloads, links in email, CSRF allow-list                                                       |
| `API_BASE_URL`         | Yes      | The API base, same origin plus `/api/v1`                                                                                    |
| `CSRF_TRUSTED_ORIGINS` | Optional | Comma-separated extra first-party origins allowed to submit authenticated forms. Exact origins, no wildcards                |
| `SESSION_COOKIE_NAME`  | Optional | Name of the session cookie                                                                                                  |
| `SESSION_SECRET`       | Yes      | HMAC key for the signed cookies used during Google sign-in                                                                  |
| `APP_ENCRYPTION_KEY`   | Yes      | Seals admin MFA secrets at rest                                                                                             |
| `HASH_PEPPER`          | Yes      | Mixed into password hashes and into the privacy hashes of IP addresses used by rate limits and activity records             |
| `GOOGLE_CLIENT_ID`     | Optional | Google Identity Services web client ID. Enables "Continue with Google" for vendors; see [Google sign-in](google-sign-in.md) |
| `MFA_ISSUER`           | Optional | Name shown in the authenticator app for admin MFA                                                                           |
| `ADMIN_MFA_REQUIRED`   | Optional | `true` or `false`. When `false`, admins sign in with password only and step-up checks are skipped                           |

Do not rotate `SESSION_SECRET`, `APP_ENCRYPTION_KEY` or `HASH_PEPPER` casually: a new pepper makes
every stored password unverifiable, and a new encryption key makes enrolled MFA secrets unreadable.
A new `SESSION_SECRET` only cancels Google sign-ins in progress (it signs their short-lived
cookies); it does not sign anyone out. How to set a variable on Vercel is in the
[deployment checklist](deployment-checklist.md#other-vercel-tasks).

### Database

| Name                     | Required | Purpose                                                                                                                                                                                                                                                                                                       |
| ------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`           | Yes      | Runtime connection. On Vercel this is the Supabase transaction pooler (see [database on Supabase](database-supabase.md))                                                                                                                                                                                      |
| `DIRECT_DATABASE_URL`    | Optional | Direct/session connection used by `pnpm db:migrate` and `pnpm dev:up`'s migration step. Not in the schema; read by `packages/db/src/connection.ts`                                                                                                                                                            |
| `DATABASE_POOL_MIN`      | Optional | Pool size floor                                                                                                                                                                                                                                                                                               |
| `DATABASE_POOL_MAX`      | Optional | Pool size ceiling. Keep it very small on serverless                                                                                                                                                                                                                                                           |
| `DATABASE_SSL`           | Optional | `disable`, `require` or `verify-full`. When unset, TLS is off for localhost and required for remote hosts                                                                                                                                                                                                     |
| `DATABASE_SSL_ROOT_CERT` | Optional | The CA certificate's PEM **text** (not a file path), required by `verify-full`. For the hosted database it is Supabase's public root CA, committed as `scripts/supabase/supabase-root-2021-ca.crt`; see [database on Supabase](database-supabase.md#the-ca-certificate)                                       |
| `MIGRATION_MAINTENANCE`  | Optional | Server-only switch, not in the schema. Exactly `1` makes `apps/web/proxy.ts` answer every request except static assets with a retryable 503 maintenance response. Read per request by `apps/web/lib/infra/migration-maintenance.ts`. It does not stop requests already running or a separately running worker |

### Redis and rate limits

| Name                    | Required | Purpose                                                                                                                                                                                                                                                      |
| ----------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `REDIS_URL`             | Yes      | Shared rate-limit store (and the worker's BullMQ queue). If unreachable, the web app falls back to per-process limits and logs it                                                                                                                            |
| `RATE_LIMIT_MULTIPLIER` | Optional | Multiplies every rate-limit allowance (counts only, never time windows). A positive number up to 1000; default `1`, the calibrated policy, which production uses. Raise it only for a test environment where end-to-end runs would otherwise trip the limits |

### Ai generation

| Name                           | Required          | Purpose                                                                                                                   |
| ------------------------------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`            | One in production | Provider credential. Precedence when several are set: Anthropic, then OpenAI, then Gemini; none selects the stub provider |
| `OPENAI_API_KEY`               | One in production | As above                                                                                                                  |
| `GEMINI_API_KEY`               | One in production | As above (Google AI Studio key)                                                                                           |
| `AI_REQUEST_TIMEOUT_MS`        | Optional          | Time budget for one whole generation, shared by its internal attempts                                                     |
| `AI_DEFAULT_MODEL`             | Optional          | Read only by the seed: the model written into the prompt versions it seeds. Not in the schema                             |
| `AI_REASONING_EFFORT_OVERRIDE` | Optional          | Read only by the seed: the reasoning effort written into the prompt versions it seeds. Not in the schema                  |
| `OPENAI_DEFAULT_MODEL`         | Optional          | Not read                                                                                                                  |
| `OPENAI_FALLBACK_MODEL`        | Optional          | Not read. There is deliberately no automatic fallback model                                                               |
| `OPENAI_REASONING_EFFORT`      | Optional          | Not read                                                                                                                  |
| `AI_MAX_OUTPUT_TOKENS`         | Optional          | Not read                                                                                                                  |

The model, reasoning effort and output limit that actually run come from the ACTIVE row in
`ai_prompt_versions`, changed through the admin console or `pnpm ai:model`, not from these
variables. See [Ai generation](../features/ai-generation.md).

### Payments (Razorpay)

| Name                      | Required | Purpose                                                                                                                                                                                  |
| ------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RAZORPAY_KEY_ID`         | Optional | API key id. With the secret and webhook secret, enables online checkout; also needed for refunds and reconciliation. A `rzp_test_` or `rzp_live_` prefix is reported by the health check |
| `RAZORPAY_KEY_SECRET`     | Optional | API key secret                                                                                                                                                                           |
| `RAZORPAY_WEBHOOK_SECRET` | Optional | Verifies `/api/v1/webhooks/razorpay` signatures                                                                                                                                          |
| `RAZORPAY_ANNUAL_PLAN_ID` | Optional | Not read. Checkout creates one-off orders, not a recurring plan                                                                                                                          |
| `RAZORPAY_BASE_URL`       | Optional | Orders API origin override for a rehearsal against a fake endpoint. Never set in production                                                                                              |

Without the three Razorpay values, the upgrade button says payment is not set up and an admin grants
Pro from `/admin` instead. See [billing and plans](../features/billing-and-plans.md).

### Email and scheduled work

| Name                      | Required           | Purpose                                                                                                                            |
| ------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `EMAIL_FROM`              | Yes                | Sender address for transactional email                                                                                             |
| `RESEND_API_KEY`          | Optional           | Enables the Resend transport, **in development too**. Without it development prints to the console and production fails every send |
| `SES_REGION`              | Optional           | Not read (Resend replaced the planned SES transport)                                                                               |
| `CRON_SECRET`             | Yes, in production | Bearer token Vercel Cron sends to `/api/cron/*`. Without it those routes answer 503                                                |
| `ACTIVITY_RETENTION_DAYS` | Optional           | Days of user-activity rows kept; the daily subscription cron purges older ones                                                     |

See [email and scheduled jobs](email-and-scheduled-jobs.md).

### Plans and locale

| Name                          | Required | Purpose                                                                           |
| ----------------------------- | -------- | --------------------------------------------------------------------------------- |
| `DEFAULT_TIMEZONE`            | Optional | Timezone for new businesses, admin date formatting and the worker's daily rollups |
| `FREE_AI_GENERATION_LIMIT`    | Optional | Not read                                                                          |
| `PRO_ANNUAL_GENERATION_LIMIT` | Optional | Not read                                                                          |
| `PRO_ANNUAL_PRICE_PAISE`      | Optional | Not read                                                                          |

The Free and Pro draft allowances and the Pro price come from the `platform_settings` table, edited
in `/admin/settings`, with fallback defaults in `packages/core/src/platform/settings.ts`. The three
plan variables above are left over from an earlier design.

### Storage, custom domains and observability

| Name                              | Required | Purpose                                                                                         |
| --------------------------------- | -------- | ----------------------------------------------------------------------------------------------- |
| `S3_PUBLIC_BASE_URL`              | Optional | Host that stored logo/cover paths are resolved against on the public profile and profile editor |
| `S3_BUCKET`                       | Yes      | Not read. Uploads are not implemented                                                           |
| `S3_ENDPOINT`                     | Optional | Not read                                                                                        |
| `S3_REGION`                       | Optional | Not read                                                                                        |
| `S3_ACCESS_KEY_ID`                | Optional | Not read                                                                                        |
| `S3_SECRET_ACCESS_KEY`            | Optional | Not read                                                                                        |
| `CLOUDFLARE_API_TOKEN`            | Optional | Not read. Custom-domain automation is not built                                                 |
| `CLOUDFLARE_ZONE_ID`              | Optional | Not read                                                                                        |
| `CLOUDFLARE_SAAS_FALLBACK_ORIGIN` | Optional | Not read                                                                                        |
| `SENTRY_DSN`                      | Optional | Not read                                                                                        |
| `OTEL_EXPORTER_OTLP_ENDPOINT`     | Optional | Not read                                                                                        |
| `LOG_LEVEL`                       | Optional | Log level of the standalone worker                                                              |

### Set by the platform

| Name     | Purpose                                                                                                                             |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `VERCEL` | Set by Vercel. When it is `1`, the client IP is taken only from Vercel's own forwarding headers (`apps/web/lib/http/rate-limit.ts`) |

### Seed only (`scripts/db/seed.ts`)

| Name                     | Purpose                                                                                        |
| ------------------------ | ---------------------------------------------------------------------------------------------- |
| `SEED_OWNER_PASSWORD`    | Overrides the demo owner's documented development password                                     |
| `SEED_ADMIN_PASSWORD`    | Gives the demo admin a usable password (otherwise it has none) and lets a re-seed overwrite it |
| `SEED_GOOGLE_REVIEW_URL` | Points the demo tenant at a real, validated Google review link instead of the placeholder      |

### Maintenance settings (`WORKER_*`)

Read by the standalone worker (`apps/worker/src/config.ts`), all optional, each with a default:
`WORKER_QUEUE_PREFIX`, `WORKER_CONCURRENCY`, `WORKER_HEALTH_PORT`, `WORKER_SHUTDOWN_TIMEOUT_MS`,
`WORKER_ANALYTICS_LOOKBACK_DAYS`, `WORKER_PARTITION_MONTHS_AHEAD`,
`WORKER_ANALYTICS_RETENTION_MONTHS`, `WORKER_PARTITION_DROP_ENABLED`,
`WORKER_MAX_PARTITION_DROPS_PER_RUN`, `WORKER_SESSION_PURGE_GRACE_DAYS`,
`WORKER_DOMAIN_POLL_BATCH`. The worker also needs everything in
[Required to boot](#required-to-boot). Read the file for defaults and limits. None is in the schema.

Two of them are **not worker-only**: the deployed maintenance cron (`/api/cron/maintenance`,
through `apps/web/lib/cron/maintenance-store.ts`) also reads `WORKER_PARTITION_MONTHS_AHEAD`
(default 3) and `WORKER_SESSION_PURGE_GRACE_DAYS` (default 7). Setting either in the Vercel project
changes production maintenance.

### Tests and tooling

| Name                                                                         | Used by                                                                                                                   |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Browser-test variables (`E2E_*` and the specs' screenshot and debug folders) | The Playwright config and specs. Listed once, with their meaning, in [e2e/README.md](../../e2e/README.md#other-variables) |
| `FFMPEG_PATH`                                                                | `scripts/media/render-*.mjs`: path to a full `ffmpeg` build                                                               |

## Adding a variable

Add it to `packages/config/src/env.ts` with a rule, to `.env.example` with a comment (name only, no
real value), and to this page. If production needs it, the owner sets it in the Vercel project;
do not assume a deployment has it until someone has checked.

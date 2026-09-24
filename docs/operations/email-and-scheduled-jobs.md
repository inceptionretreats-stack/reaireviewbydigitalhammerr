# Email and scheduled jobs

How the app sends transactional email, which emails exist, what the three Vercel Cron jobs do and
how they are protected, what the health endpoint does and does not prove, and how the optional
standalone worker relates to all of this. Read it before touching mail, cron routes, the worker or
their environment variables.

## Email

### The mailer

`apps/web/lib/email/mailer.ts` exposes `mailer()`, which picks one transport per process:

| Condition                                 | Transport                   | Behaviour                                                                                                                 |
| ----------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `RESEND_API_KEY` is set (any environment) | `ResendTransport`           | One `POST https://api.resend.com/emails` per message, from `EMAIL_FROM`, 10 s timeout. Errors report only the HTTP status |
| No key, `NODE_ENV` is `production`        | `UnconfiguredMailTransport` | Logs "NO TRANSPORT CONFIGURED" and rejects every send                                                                     |
| No key, any other environment             | `ConsoleMailTransport`      | Prints recipient and subject; in development also prints the first link in the body                                       |

Consequences worth knowing:

- A development machine with `RESEND_API_KEY` in `.env` sends **real email**.
- The console transport's printed link can be a live password-reset or admin-invite link. Treat
  the dev server log as sensitive.
- No transport logs a message body; bodies can hold reset tokens, legal names or GSTINs.
- `mailConfigured()` reports whether a real provider is set, so screens can say "not sent" rather
  than pretend. A configured key does not prove that the sending domain is verified or that mail
  is delivered.

Sender-domain (DNS) verification for Resend was **paused by the owner**. Do not change DNS,
nameservers or Cloudflare settings for it without the owner's explicit permission and access to
the correct zone.

### Which emails exist

Templates are in `apps/web/lib/email/email-templates.ts`.

| Template                   | Sent when                                                                    | Sent from                                                                                                   |
| -------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `passwordResetEmail`       | An owner asks to reset a password, or an admin triggers a reset for an owner | `app/api/v1/auth/forgot-password/route.ts`, `lib/admin/owner-actions.ts`                                    |
| `adminInviteEmail`         | A super-admin invites a team member                                          | `app/api/v1/admin/team/route.ts`                                                                            |
| `receiptEmail`             | A Pro payment settles (browser callback or webhook), or an admin resends it  | `lib/billing/receipt-mail.ts`, called from the verify route, the Razorpay webhook and admin payment actions |
| `renewalReminderEmail`     | 30, 7 or 1 day before a paid year ends (nearest due reminder only)           | `lib/cron/subscriptions.ts` (daily cron)                                                                    |
| `subscriptionExpiredEmail` | A paid year has ended                                                        | `lib/cron/subscriptions.ts` (daily cron)                                                                    |
| `abuseWarningEmail`        | An admin warns a business owner about abuse                                  | `lib/admin/owner-actions.ts`                                                                                |

Paths are relative to `apps/web`. Forgot-password answers the same way whether or not the email
went out; a failure is only visible in the server log. In production without a key, the admin
reset and warning actions skip the send and report it as not sent.

## Vercel Cron jobs

Declared in `apps/web/vercel.json` (which also pins functions to the `sin1` region). Vercel calls
each path with `GET` and `Authorization: Bearer <CRON_SECRET>`.

| Path                      | Schedule (UTC) | IST   | Handler                                                             | Does                                                                                                                                                                    |
| ------------------------- | -------------- | ----- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/cron/subscriptions` | 00:30 daily    | 06:00 | `app/api/cron/subscriptions/route.ts` → `lib/cron/subscriptions.ts` | Marks lapsed paid years EXPIRED (with a SYSTEM audit row), queues due reminders, sends queued reminders, purges user-activity rows older than `ACTIVITY_RETENTION_DAYS` |
| `/api/cron/health`        | 02:30 daily    | 08:00 | `app/api/cron/health/route.ts` → `lib/infra/backend-health.ts`      | Database and Redis reachability, plus whether Ai, email and payment credentials are configured                                                                          |
| `/api/cron/maintenance`   | 03:10 daily    | 08:40 | `app/api/cron/maintenance/route.ts` → `lib/cron/maintenance*.ts`    | Ensures upcoming `analytics_events` partitions exist, purges expired sessions, computes daily analytics rollups                                                         |

### Authorisation

`apps/web/lib/cron/auth.ts` compares the bearer token with `CRON_SECRET` in constant time. Every
cron route answers **503** when `CRON_SECRET` is unset and **401** for a missing or wrong token.
The production environment schema refuses to boot without `CRON_SECRET`. Never expose the secret
or paste a health or maintenance response publicly.

### Subscription sweep

Each step is idempotent, so running it twice is safe. Reminders are stored as rows before they are
emails (one per subscription, period end and kind), so a repeated or late run never sends a
duplicate, and a late run sends only the nearest due reminder. Without a mail transport nothing is
attempted; queued reminders wait and are sent by the first run after a key is configured (stale
ones are skipped). The route returns counts: expired, queued, sent, failed, skipped,
`activity_purged`, and whether mail was `resend` or `unconfigured`.

### Health check

`/api/cron/health` makes only two network calls: `SELECT 1` on an isolated one-connection pool and a
Redis `PING`, each with a 3 s deadline. Everything else is a presence check of environment values.

| Result     | HTTP | Meaning                                                                                      |
| ---------- | ---- | -------------------------------------------------------------------------------------------- |
| `healthy`  | 200  | Database and Redis answered; an Ai key, email settings and all three Razorpay values are set |
| `warning`  | 200  | As above, but email or payments are not configured                                           |
| `degraded` | 503  | Database or Redis did not answer, or no Ai provider key is set                               |

Each configuration check carries `verified: false`: "configured" means a value is present, not
that the Ai key works, mail is delivered or payments succeed. The payment check also reports
`live`, `test` or `unknown` from the Razorpay key prefix. Responses never include hosts, users,
credentials or raw errors, and are sent `no-store`.

### Maintenance

`/api/cron/maintenance` depends on the `maintenance_jobs` table from migration
`0007_maintenance_jobs`. Each run has a 30 s work budget and up to 200 analytics units. Every
completed unit is checkpointed in the database, and each job takes a transaction-level advisory
lock, so overlapping runs do not double up. The response status is:

- `complete` — nothing left to do;
- `pending` — the budget ran out or expired sessions remain; the next run resumes from the
  checkpoint;
- `busy` — another run holds the lock.

A failure returns 500 without the database error text; completed units are safe to retry. It
never drops old analytics partitions. An operator may call it by hand with the bearer token to
catch up.

## The optional standalone worker

`apps/worker` is a BullMQ worker (`apps/worker/src/index.ts`). It is **not deployed** on Vercel and
needs a real Redis plus the full [boot environment](environment.md#required-to-boot). It schedules,
in UTC:

| Job                               | Schedule        | Overlaps with the Vercel Cron path                                                                                         |
| --------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `analytics.daily-rollup`          | 00:20 daily     | Yes: `/api/cron/maintenance` rollups                                                                                       |
| `analytics.partition-maintenance` | 03:10 daily     | Yes, except the worker can also drop partitions past retention when `WORKER_PARTITION_DROP_ENABLED` is on (off by default) |
| `auth.session-purge`              | Hourly at :40   | Yes: `/api/cron/maintenance` session purge                                                                                 |
| `domains.status-poll`             | Every 5 minutes | No. Uses `UnconfiguredCustomDomainProvider`, so every check fails fast; custom domains are not built                       |

The web app reuses the worker's side-effect-free helpers through the package export
`@ai-review/worker/maintenance` (`apps/worker/src/maintenance.ts`): date buckets, rollup metrics and
the analytics and partition stores. It never imports the worker's startup entry.

Do not run the worker blindly against a database that Vercel Cron already maintains; decide first
which path owns each job. `pnpm dev` at the
repository root starts the worker too (see [local development](local-development.md#commands-with-side-effects)).

## Related

- [Environment variables](environment.md) — `RESEND_API_KEY`, `EMAIL_FROM`, `CRON_SECRET`,
  `ACTIVITY_RETENTION_DAYS`, worker settings.
- [Billing and plans](../features/billing-and-plans.md) — receipts, renewals and expiry.
- [Data model](../architecture/data-model.md) — `analytics_events` partitions and rollups.

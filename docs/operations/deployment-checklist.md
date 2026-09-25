# Deployment checklist

What to confirm and run before, during and after deploying Ai Review, including the Vercel CLI
steps. This is the deployment runbook. The runbook from the first deployment in September 2026 is
kept only as a [historical record](../history/2026-09-17-vercel-deploy-runbook.md); do not follow
it. For the database, use [database on Supabase](database-supabase.md). Every deployment,
production migration and production environment change needs the project owner's explicit approval
for that specific change; a document mentioning deployment is not permission.

## What gets deployed where

| Piece                 | Where                                                                                                                 |
| --------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `apps/web` (UI + API) | The owner's existing Vercel project, **Root Directory `apps/web`**, Node 24.x, framework Next.js                      |
| Function region       | `sin1` (Singapore), pinned in `apps/web/vercel.json` together with the three cron schedules                           |
| PostgreSQL            | The owner's Supabase project (runtime through the transaction pooler, migrations through a direct/session connection) |
| Redis                 | The configured `REDIS_URL` provider (rate limits)                                                                     |
| `apps/worker`         | Not deployed. Vercel Cron covers maintenance; see [email and scheduled jobs](email-and-scheduled-jobs.md)             |
| Production hostname   | `aireview.digitalhammerr.com`, specified by the owner                                                                 |

- **Why `sin1`.** No document records a reason. The region was set at the first deployment (12
  September 2026), when the database was Neon in `aws-ap-southeast-1` (Singapore). The database is
  now Supabase in Mumbai (`ap-south-1`). Keep `sin1` unless the owner approves a change; changing
  the region is a deployment change.
- **Hosting plan.** Vercel's Hobby plan is licensed for personal, non-commercial use. Confirm the
  project is on a plan that permits commercial use (Vercel Pro or another host) before charging
  businesses. That belongs with switching Razorpay to live keys; see the open decisions on the
  [hosting plan](../decisions/open-decisions.md#hosting-plan) and
  [payments mode](../decisions/open-decisions.md#payments-mode).

Deploy only to the Vercel account and project the owner designated. Check the local link
(`.vercel/project.json`, which is git-ignored) and the project's settings before uploading; do not
assume they are unchanged since the last deployment, and never deploy to a different account by
default.

## Before deploying

1. **Approval.** The owner has approved this deployment, its target (preview or production) and
   the exact change set.
2. **Working tree.** Run `git status --short` and read the diffs. Deploy only the reviewed change
   set. Do not blanket-commit other people's uncommitted work to get it included, and do not leave
   out part of a coupled change (for example a schema change, its migration and the code that
   reads it). The maintenance work of September 2026 (the maintenance cron route, the
   `@ai-review/worker/maintenance` export, the `maintenance_jobs` schema and migration `0007`) was
   such a set; it is now committed, and `0007` was applied at the Supabase cutover.
3. **Checks.** `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`,
   `pnpm check:migrations` and `pnpm --filter @ai-review/web build` pass locally; integration and
   browser tests for the affected area pass where relevant. What CI runs is listed in
   [testing](testing.md#continuous-integration).
4. **Environment.** Every variable production needs exists in the Vercel project (names in
   [environment](environment.md)): at minimum the boot set, one Ai provider key, `CRON_SECRET`, and
   an HTTPS public `APP_BASE_URL`. Check names only; never print or copy values. Reject any advice
   to unset `NODE_ENV` or weaken a guard to get a task through.
5. **Migrations.** Compare `packages/db/drizzle/meta/_journal.json` with what the target database
   has applied, using the read-only query in
   [database on Supabase](database-supabase.md#running-later-migrations). Migration
   `0009_hot_path_indexes` may not be applied in production yet
   ([known issue #12](../known-issues.md)). If a migration is needed:
   - get the owner's approval for applying it;
   - apply it exactly as in
     [running later migrations](database-supabase.md#running-later-migrations), which gives the
     runtime file to prepare and the command to run. Never use the local `.env` for it. **Never
     apply migrations to a guessed database**, and never log full connection strings;
   - apply it **before** deploying code that depends on it;
   - if the migration adds a table, add it to the allowlist in `scripts/supabase/lock-down.sql` in
     the same change, and re-apply that script to production afterwards, in its own transaction and
     with the owner's approval (see
     [keeping lock-down.sql in step](database-supabase.md#keeping-lock-downsql-in-step));
   - never edit an applied migration, and do not re-apply `0007_maintenance_jobs` by hand.
     For a disruptive migration, the `MIGRATION_MAINTENANCE=1` gate returns a retryable 503 for all
     requests. It does not drain requests already running, stop a separately running worker, or
     protect older deployment URLs that still reach the same database.
6. **Upload contents.** Read `.vercelignore` and confirm it still excludes local environment files
   (`.env`, `.env.*` except `.env.example`), `.vercel/`, `.git/`, the local database (`.pgdata`),
   `.dev/` logs, `node_modules/`, build output, test output, `*.log`, `.agents/` and
   `scripts/media/assets/` (render source art the site does not serve). `vercel deploy --dry --json`
   lists what would be uploaded.

## Deploying

Build locally first, then create a production-target deployment **without moving the live
domain**, verify it, and only then promote it:

```sh
pnpm --filter @ai-review/web build
vercel deploy --prod --skip-domain --yes --archive=tgz   # from the repository root
vercel promote <deployment-url>                           # only after the checks below pass
```

`--archive=tgz` uploads one archive instead of thousands of files; without it the marketing media
made the upload stall. The CLI attaches the latest commit's author, and Vercel rejects a release
whose author lacks project access. Keep Git metadata intact and resolve access properly: never
rewrite history, hide metadata or disable deployment protection to get a deployment through.
`vercel inspect <deployment-url> --logs` shows why a build failed.

## After deploying

Before promotion, against the new deployment URL, and again on the live hostname after promotion:

- Public pages (`/`, `/login`, `/signup`) return 200; `/app` and `/onboarding/business` redirect to
  `/login`; an unauthenticated `GET /api/v1/business` returns 401.
- The change itself works where it is observable without real customer data.
- The deployment's error logs show nothing new.
- If a QR or slug route is checked, remember that a visit creates normal scan and session records
  in production.

Record the result in the [changelog](../history/changelog.md): what was deployed, which checks ran
and, just as important, what was **not** verified live (for example payments, email delivery,
real Ai generation, or authenticated end-to-end flows). Public smoke checks do not prove those.

## Rolling back

Promote an earlier deployment only if it works with the current database schema and data. Do not
reopen the retired pre-Supabase database, rerun the Supabase refresh or restore, or promote a
deployment that points at the old database: the Supabase database has accepted writes since the
cutover. Any data recovery needs a reviewed plan agreed with the owner; see
[database on Supabase](database-supabase.md).

## Other Vercel tasks

Run these from the repository root with a CLI session signed in to the owner's designated account.

| Task                          | How                                                                                                                                                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Link a working copy           | `vercel link --project <project> --yes` writes the git-ignored `.vercel/`. Confirm the account and project first                                                                                                          |
| Project settings              | Root Directory `apps/web`, Node `24.x` and framework `nextjs` are project settings the CLI cannot set non-interactively. Set them in the Vercel dashboard, or through Vercel's REST API (`PATCH /v9/projects/<id>`)       |
| Set or rotate a variable      | `vercel env add NAME production --sensitive --force`, then redeploy. Without `--value` the CLI asks for the value, which keeps a secret out of shell history. Read the rotation warnings in [environment](environment.md) |
| Read production variables     | Do not use `vercel env pull` as a backup or to fill the root `.env`: sensitive values come back as `[SENSITIVE]` placeholders, and the root `.env` must stay local                                                        |
| Register the Razorpay webhook | See below                                                                                                                                                                                                                 |
| Check a cron job by hand      | See below                                                                                                                                                                                                                 |

### Razorpay webhook

In the Razorpay dashboard, register `<APP_BASE_URL>/api/v1/webhooks/razorpay` with the secret held
in `RAZORPAY_WEBHOOK_SECRET`, for these events: `payment.captured`, `order.paid`, `payment.failed`,
`refund.created`, `refund.processed` and `refund.failed`. The handler settles orders on the first
two, marks orders failed on `payment.failed` and applies refunds on the `refund.*` events (see
[billing and plans](../features/billing-and-plans.md)). Refunds and reconciliation from
`/admin/payments` also need `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`. Production deliberately
uses test-mode keys; switching to live keys means registering the webhook again for live mode.

### Checking a cron job by hand

Vercel Cron calls each `/api/cron/*` path with `Authorization: Bearer <CRON_SECRET>` on the
schedule in [email and scheduled jobs](email-and-scheduled-jobs.md#vercel-cron-jobs). To call one
yourself, load the secret into the shell's environment without typing or printing it, then:

```sh
curl -H "Authorization: Bearer $CRON_SECRET" https://aireview.digitalhammerr.com/api/cron/health
```

In Windows PowerShell use `curl.exe` and `$env:CRON_SECRET`. `/api/cron/health` only reads (a
database `SELECT 1` and a Redis `PING`) and answers 503 when the result is `degraded`. The
subscriptions and maintenance jobs do real work in production (expiring paid years, sending
reminder email, purging rows), so call them by hand only with the owner's approval. Never paste a
cron response or the secret publicly. Whether the scheduled runs succeed is visible in the Vercel
project's cron logs.

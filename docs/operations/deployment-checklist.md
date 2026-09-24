# Deployment checklist

What to confirm before, during and after deploying Ai Review. Every deployment, production
migration and production environment change needs the project owner's explicit approval for that
specific change; a document mentioning deployment is not permission. The step-by-step CLI runbook
is [deploying to Vercel](deploy-vercel.md) (partly historical) and the database runbook is
[database on Supabase](database-supabase.md).

## What gets deployed where

| Piece                 | Where                                                                                                                 |
| --------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `apps/web` (UI + API) | The owner's existing Vercel project, **Root Directory `apps/web`**, Node 24.x                                         |
| Function region       | `sin1`, pinned in `apps/web/vercel.json` together with the three cron schedules                                       |
| PostgreSQL            | The owner's Supabase project (runtime through the transaction pooler, migrations through a direct/session connection) |
| Redis                 | The configured `REDIS_URL` provider (rate limits)                                                                     |
| `apps/worker`         | Not deployed. Vercel Cron covers maintenance; see [email and scheduled jobs](email-and-scheduled-jobs.md)             |
| Production hostname   | `aireview.digitalhammerr.com`, specified by the owner                                                                 |

Deploy only to the Vercel account and project the owner designated. Check the local link
(`.vercel/project.json`, which is git-ignored) and the project's settings before uploading; do not
assume they are unchanged since the last deployment, and never deploy to a different account by
default.

## Before deploying

1. **Approval.** The owner has approved this deployment, its target (preview or production) and
   the exact change set.
2. **Working tree.** Run `git status --short` and read the diffs. Deploy only the reviewed change
   set. Do not blanket-commit other people's uncommitted work to get it included, and do not leave
   out part of a coupled change. The maintenance implementation is one such set:
   - `apps/web/lib/cron/maintenance*.ts` and `apps/web/app/api/cron/maintenance/route.ts`;
   - `apps/worker/src/maintenance.ts` and the `@ai-review/worker/maintenance` export and
     dependency wiring;
   - `packages/db/src/schema/maintenance.ts` and the schema index;
   - `packages/db/drizzle/0007_maintenance_jobs.sql`, its snapshot and the migration journal.
3. **Checks.** `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`,
   `pnpm check:migrations` and `pnpm --filter @ai-review/web build` pass locally; integration and
   browser tests for the affected area pass where relevant (see [testing](testing.md)).
4. **Environment.** Every variable production needs exists in the Vercel project (names in
   [environment](environment.md)): at minimum the boot set, one Ai provider key, `CRON_SECRET`, and
   an HTTPS public `APP_BASE_URL`. Check names only; never print or copy values. Reject any advice to
   unset `NODE_ENV` or weaken a guard to get a task through.
5. **Migrations.** Compare `packages/db/drizzle/meta/_journal.json` with what the target database
   has applied (a read-only query of the Drizzle migrations table). If a new migration is needed:
   - get the owner's approval for applying it;
   - apply it with `pnpm db:migrate`, which prefers `DIRECT_DATABASE_URL` (direct/session
     connection); the running app uses the pooled `DATABASE_URL`;
   - take the host and user from the provider's own connection dialog. **Never apply migrations to
     a guessed database**, and never log full connection strings;
   - apply it **before** deploying code that depends on it;
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

The runbook's CLI flow builds locally first, then creates a production-target deployment **without
moving the live domain**, verifies it, and only then promotes it:

```sh
pnpm --filter @ai-review/web build
vercel deploy --prod --skip-domain --yes --archive=tgz   # from the repository root
vercel promote <deployment-url>                           # only after the checks below pass
```

`--archive=tgz` uploads one archive instead of thousands of files; without it the marketing media
made the upload stall. The CLI attaches the latest commit's author, and Vercel rejects a release
whose author lacks project access. Keep Git metadata intact and resolve access properly: never
rewrite history, hide metadata or disable deployment protection to get a deployment through.

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

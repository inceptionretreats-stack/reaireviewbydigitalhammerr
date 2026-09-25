# Database on Supabase

The runbook for the hosted production database: where it is, how the app connects, how to apply a
later migration, how to keep the Supabase permissions script in step when a table is added, how to
verify, and which recovery rules still apply. Read it before any command that touches the
production database. Every production migration, permissions change or database-variable change
needs the owner's explicit approval for that specific change. The 23 September 2026 move from Neon
(backups, rehearsal, row counts, compatibility review) is recorded separately in
[Supabase cutover](../history/2026-09-23-supabase-cutover.md).

## Current set-up

As recorded on 23 and 24 September 2026. Re-check the Supabase dashboard and the Vercel project
before relying on any of it.

| Item                     | Value                                                                                                                                                                                     |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Project                  | Supabase organisation **Digital Hammerr** (`fmqzifenquuoysefzfui`), project **Ai Review** (`vouqzekpujgzsplhqqor`)                                                                        |
| Plan and region          | Free plan, Mumbai (`ap-south-1`). No paid add-ons                                                                                                                                         |
| PostgreSQL               | 17.6                                                                                                                                                                                      |
| App connection           | `DATABASE_URL` in the Vercel project: the shared transaction pooler, port 6543                                                                                                            |
| Migration connection     | `DIRECT_DATABASE_URL`: the shared session pooler `aws-0-ap-south-1.pooler.supabase.com:5432`, database `postgres`, user `postgres.<project id>`. It works over IPv4 without a paid add-on |
| TLS                      | `DATABASE_SSL=verify-full` with the CA in `DATABASE_SSL_ROOT_CERT` (see [the CA certificate](#the-ca-certificate)); SSL enforcement is on                                                 |
| Data API                 | Disabled                                                                                                                                                                                  |
| Permissions              | Row-level security (RLS) on, and no `anon`, `authenticated` or `service_role` grants, on every app table, analytics partition and the journal                                             |
| Last recorded migration  | `0008_bent_darkstar`, applied 24 September 2026                                                                                                                                           |
| Non-production variables | The Vercel project's non-production `DATABASE_URL` still pointed at the retired Neon database at the cutover                                                                              |

- **Migration `0009_hot_path_indexes`** is in the repository, but nothing records it as applied in
  production; see [known issue #12](../known-issues.md). Compare before every deployment (step 2
  below).
- **Confirm the target.** Reconfirm the organisation and project in the intended signed-in account
  before any cloud or database write. An unrelated account seen through a connector is not
  permission to use its projects.
- **Credentials.** Production reads its database settings from the Vercel project's server-only
  variables. On the owner's machine, the git-ignored `.env.supabase.local` (access restricted to
  the owner's Windows account) holds connection metadata and the owner-supplied credential. It is
  input for preparing a migration, **not** a runnable env file. Never log or commit credentials, and
  rotate a credential in the Vercel project and the migration connection together.
- **Previews.** Do not reopen the Neon database to make a preview deployment work; choosing a
  preview database is a separate decision.
- **Security Advisor** reports one `citext`-in-public warning and RLS-without-policy notices. Both
  are expected: the columns depend on `public.citext`, the Data API is off, and the app does not
  use browser-role policies (see [Architecture](#architecture) and the reasoning in the cutover
  record's
  [restore rehearsal](../history/2026-09-23-supabase-cutover.md#restore-rehearsal-and-private-backup)).
  Do not add permissive policies to clear them.

## Architecture

The existing Next.js API, custom login/session system and business access checks stay on Vercel.
Supabase hosts PostgreSQL. Drizzle uses a private server connection; no Supabase service key or
database password belongs in browser code. Supabase Auth is not used: existing accounts are
in `public.users`, not `auth.users`. Do not add `auth.uid()` policies to these tables.

- **Driver.** The app uses Drizzle's node-postgres (`pg`) adapter, which sends unnamed queries, so
  it works through the transaction pooler as it is. Do not add the Postgres.js-only
  `prepare: false` option.
- **Pool size.** On Vercel keep `DATABASE_POOL_MIN=0` and `DATABASE_POOL_MAX=1`. Each serverless
  instance opens its own pool, and the code's defaults (up to 20 connections, 2 held open) suit a
  long-running server, not a serverless function.

Redis, email, Ai provider credentials, payment configuration and scheduled tasks remain separate
services. A database move does not configure those services.

## The CA certificate

`scripts/supabase/supabase-root-2021-ca.crt` is Supabase's public root certificate (Supabase Root
2021 CA, valid until April 2031). It is the same certificate the cutover used, and it is not a
secret. It is used in two ways:

- **By the app and the migration runner.** `DATABASE_SSL_ROOT_CERT` holds the certificate's PEM
  **text**, not a file path. `packages/db/src/connection.ts` passes it to node-postgres, and
  `verify-full` refuses to connect without it. In an env file, wrap the multi-line text in double
  quotes.
- **By `psql`.** `sslrootcert=` takes the file path.

Never switch to `DATABASE_SSL=require` or turn verification off to get past a certificate error.
If Supabase replaces its CA, download the new one from the project's database settings in the
Supabase dashboard, replace the file in a reviewed change, and update `DATABASE_SSL_ROOT_CERT` in
the Vercel project.

## Running later migrations

1. **Approval.** The owner approves applying this migration to production.
2. **Compare, read-only.** List what production has applied and compare it with
   `packages/db/drizzle/meta/_journal.json`:

   ```sql
   SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id;
   ```

   `created_at` matches each journal entry's `when`. Apply only what is missing, and never edit an
   applied migration.

3. **Prepare a runtime file.** Create `.env.supabase.runtime.local` at the repository root for this
   run only. `.gitignore` and `.vercelignore` already exclude `.env.*`. Take the session-pooler
   connection string from the Supabase Connect dialog or from the owner; never guess a host or user.

   ```text
   DIRECT_DATABASE_URL=<session pooler connection string, port 5432>
   DATABASE_SSL=verify-full
   DATABASE_SSL_ROOT_CERT="-----BEGIN CERTIFICATE-----
   <the lines of scripts/supabase/supabase-root-2021-ca.crt>
   -----END CERTIFICATE-----"
   ```

   Do not use `.env` (the local database) or `.env.supabase.local` (metadata, not runnable).

4. **Run the migration** from the repository root, **before** deploying code that depends on it:

   ```powershell
   node --env-file=.env.supabase.runtime.local node_modules/tsx/dist/cli.mjs packages/db/src/migrate.ts
   ```

   The runner uses `DIRECT_DATABASE_URL` (falling back to `DATABASE_URL`) over one connection.
   Variables already set in your shell win over the file, so start from a shell with no
   `DIRECT_DATABASE_URL`, `DATABASE_URL` or `DATABASE_SSL*` variables set. Do not use
   `node --env-file=… --run db:migrate`: on Node 24, `--run` does not pass the file's variables to
   the script, and the runner stops with "DIRECT_DATABASE_URL or DATABASE_URL is required" (checked
   on Node 24.19.0).

5. **Re-apply the permissions script** if the migration added a table, or redefined
   `ensure_analytics_events_partition` or `reset_pro_quota_on_period_change`; see the next section.
6. **Verify** as below, then **delete** `.env.supabase.runtime.local`.

For a disruptive migration, the `MIGRATION_MAINTENANCE=1` gate (see
[rules that still apply](#rules-that-still-apply)) answers every request with a retryable 503.

## Keeping lock-down.sql in step

`scripts/supabase/lock-down.sql` is live, maintained tooling, not a leftover of the cutover. It
enables RLS and revokes all `anon`, `authenticated` and `service_role` privileges on an explicit
allowlist of app tables, every `analytics_events` partition, the app sequences and the Drizzle
journal. It also redefines `ensure_analytics_events_partition` so that partitions created later
get the same protection. It adds no policies. It runs in its own transaction and stops, changing
nothing, if the Supabase roles are missing, a listed table is missing or owned by another role, or a
table already has RLS policies.

When a migration adds or removes a table:

1. **In the same change**, update the `app_tables` allowlist in `lock-down.sql`.
   `scripts/supabase/__tests__/lock-down.test.ts` compares the allowlist with the tables exported
   by `packages/db/src/schema` and fails `pnpm test` until they match. Run it on its own with:

   ```powershell
   pnpm exec vitest run scripts/supabase/__tests__/lock-down.test.ts
   ```

   This checks the file offline; it does not prove anything about the database.

2. **After applying the migration**, and with the owner's approval, apply the script to production
   from the repository root, as the role that owns the app tables, separately from the migration:

   ```powershell
   psql "host=aws-0-ap-south-1.pooler.supabase.com port=5432 dbname=postgres user=postgres.<project id> sslmode=verify-full sslrootcert=scripts/supabase/supabase-root-2021-ca.crt" -v ON_ERROR_STOP=1 -f scripts/supabase/lock-down.sql
   ```

   `psql` asks for the password. Any `psql` 17 or newer works; the owner's portable PostgreSQL
   18.6 client is kept in the private backup folder `ai-review-private-backups/tools/`, outside the
   repository.

3. Run the permissions check in [Verification](#verification).

Until step 2 is done, a new table has no RLS on production. The script's default-privilege
statements are meant to keep new tables from receiving Data API grants, but nothing enables RLS on
a table that did not exist when the script last ran. Re-applying the script is how
`google_identities` was protected after migration `0008` on 24 September 2026.

## Verification

- **Migrations.** Every entry in `packages/db/drizzle/meta/_journal.json` has a row in
  `drizzle.__drizzle_migrations` with a matching `created_at` and hash (step 2 above).
- **Permissions.** This read-only query must return no rows:

  ```sql
  SELECT c.relname
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    AND (NOT c.relrowsecurity
      OR has_table_privilege('anon', c.oid, 'SELECT')
      OR has_table_privilege('authenticated', c.oid, 'SELECT')
      OR has_table_privilege('service_role', c.oid, 'SELECT'));
  ```

- **TLS.** Check the connection target and the actual client TLS socket without logging
  credentials. A proxy can terminate TLS before PostgreSQL; `pg_stat_ssl` alone is not proof of
  client TLS.
- **Writes.** Use a transaction with rollback for any write probe, then check existing-account
  sign-in, business details, QR resolution, location editing, review generation and persistence
  through the app. A QR or slug visit creates normal scan and session records in production.
- **Tests.** Integration and end-to-end suites delete and reset data. Point them only at disposable
  databases, never at production.

## Rules that still apply

These come from the cutover and still hold.

- **No rollback to Neon.** The old Neon database is fenced. Do not reopen it, reconnect the app to
  it, or promote an old Neon-backed deployment: Supabase has accepted writes since the cutover, and
  a rollback would lose them.
- **If something goes wrong,** pause writes to the Supabase database first, then inspect the exact
  deployed version and configuration. Any rollback or data recovery needs reconciliation, a
  reviewed plan and the owner's explicit approval. Do not restore the cutover backups, run the demo
  seed, or rerun the cutover's restore, refresh, finalise or reset scripts (they are kept in the
  owner's private backup folder and do not run from there).
- **Not authorised by this runbook:** changes to the root schema, Supabase-managed schemas or
  extensions, and broad `CASCADE` operations.
- **The maintenance gate.** With the server-only variable `MIGRATION_MAINTENANCE=1`,
  `apps/web/proxy.ts` answers pages, API requests, Server Actions, cron, webhooks and prefetches
  with 503, `no-store` and `Retry-After: 120` before any handler runs; only generated
  `/_next/static/` GET/HEAD requests pass. It is off by default. It does not drain requests
  already running, stop a separately running worker, or protect older deployment URLs that reach
  the same database. Pausing HTTP writes alone is not a full write fence: QR entry pages, session
  resolution, QR downloads and scheduled jobs write too.
- **Identifiers stay ASCII.** The database uses the ICU `en-US` collation with `citext` 1.6, which
  does not match every Unicode case rule of the old database. Sign-up, sign-in and slug validation
  restrict emails and slugs to ASCII; supporting Unicode emails or importing such data needs a
  compatibility review first (details in the
  [cutover record](../history/2026-09-23-supabase-cutover.md#reviewed-postgresql-compatibility-differences)).
- **Backups stay private.** The cutover and reset backups are in the owner's private backup folder,
  outside the repository. Do not upload, commit, display or automatically restore them.

## Official references

- [Supabase connection methods](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Drizzle integration](https://supabase.com/docs/guides/database/drizzle)
- [Data API access controls](https://supabase.com/docs/guides/api/securing-your-api)
- [Data API exposure changes](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically)
- [Migrating PostgreSQL to Supabase](https://supabase.com/docs/guides/platform/migrating-to-supabase/postgres)
- [PostgreSQL dump version compatibility](https://www.postgresql.org/docs/18/app-pgdump.html)
- [Supabase plan limits](https://supabase.com/pricing)

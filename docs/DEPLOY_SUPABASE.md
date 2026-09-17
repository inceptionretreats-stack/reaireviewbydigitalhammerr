# Supabase database deployment

## Current status — 17 September 2026

The production web app and API are running on Vercel at
https://ai-review-dh.vercel.app, under the inceptionretreats account. The production database
is currently Neon. Supabase has **not** been connected or selected yet: the available Supabase
connector exposes a different organization, and Chrome is not connected to Codex.

A read-only production inventory found seven applied Drizzle migrations, 37 public tables
including partitions, 7 users, 5 businesses, 2 customers, 5 QR codes, 11 Ai generations and
7 payment records. These counts are a snapshot, not cutover verification. The local development
database has different data and must not replace production.

## Architecture

The existing Next.js API, custom login/session system and business access checks stay on Vercel.
Supabase hosts PostgreSQL. Drizzle uses a private server connection; no Supabase service key or
database password belongs in browser code. Supabase Auth is not used: existing accounts are
in `public.users`, not `auth.users`. Do not add `auth.uid()` policies to these tables.

Redis, email, Ai provider credentials, payment configuration and scheduled tasks remain separate
services. A database move does not configure those services.

## Target and connection setup

1. Confirm the Supabase organization belongs to `inceptionretreats@gmail.com`. Use a dedicated
   project for Ai Review; do not reuse another application's project.
2. Confirm the project's plan/cost before creating a billable resource. Select a region near
   the Vercel runtime. Check the actual Vercel deployment region, not just an old runbook.
3. From the project's Connect dialog, store two secret connection strings:
   - `DATABASE_URL`: shared transaction pooler, port 6543, for Vercel.
   - `DIRECT_DATABASE_URL`: direct connection or shared session pooler, port 5432, for migrations.
     The session pooler supports IPv4 without an add-on.
4. Set `DATABASE_POOL_MIN=0`, `DATABASE_POOL_MAX=1`. Use TLS; prefer verified TLS with the
   project CA. The shared connection helper applies the same explicit TLS settings to migrations.
5. This app uses the node-postgres Drizzle adapter and unnamed queries. Do not add the
   Postgres.js-only `prepare: false` option.

## Preserve existing data before switching

1. Take a consistent, access-restricted backup of the production Neon database using PostgreSQL
   client tools at least as new as the source server (source currently PostgreSQL 18). Keep the
   original database intact. Never commit dumps or credentials.
2. Restore only the app's `public` and `drizzle` objects/data into an empty target; exclude source
   ownership and grants. Do not replace Supabase's `auth`, `storage`, `realtime` or other managed
   schemas. Verify `pgcrypto` and `citext` availability and extension schema/search-path placement.
3. Preserve migration history when restoring schema and data. Do not separately replay migrations
   on an already restored schema. Alternatively, migrate a fresh target then import data with
   dependency/identity handling; choose one approach and verify it.
4. Preserve the production `HASH_PEPPER`, `APP_ENCRYPTION_KEY`, and `SESSION_SECRET` exactly.
   Do not run the development seed against existing production records.
   Vercel environment exports can contain `[SENSITIVE]` placeholders. They are not secret backups:
   never upload those placeholders or replace unrelated live settings from an exported file.
5. Apply `scripts/supabase/lock-down.sql` to the dedicated target after import, and disable the
   Supabase Data API for this server-only architecture. Run Supabase security advisors.
6. Compare counts, primary keys and data checksums for every app table in a consistent snapshot.
   Confirm foreign keys, sequences, indexes, partition boundaries and migration hashes.
7. Coordinate the final copy with a controlled write pause or replication catch-up. A backup taken
   while the old app continues writing is not sufficient for a lossless cutover.
8. Update the server-only Vercel database variables and deploy. Keep all other production secrets
   unchanged. Verify the new deployment before reopening writes. If writes have reached Supabase,
   reconcile them before any rollback to Neon.

## Running later migrations

The database migration runner prefers `DIRECT_DATABASE_URL` and falls back to `DATABASE_URL`.
Load environment variables into its process explicitly; scripts do not automatically load .env.
From the repository root, with a git-ignored connection file prepared for the intended target:

```powershell
node --env-file=.env.supabase.local --run db:migrate
```

Reapply the server-only permissions script after adding tables. It requires an explicit table
allowlist update when new app tables are introduced, and fails when the expected schema is absent.
The analytics partition function included in that script applies RLS and removes API-role grants
on future monthly partitions too.

## Verification

- Check the connection target and actual client TLS socket without logging credentials.
  A proxy can terminate TLS before PostgreSQL; `pg_stat_ssl` alone is not proof of client TLS.
- Compare source and target data as above; check seven migration entries (or the current journal).
- Verify RLS and denied Data API role privileges for all app tables and analytics partitions.
- Use a transaction with rollback for a write probe, then verify existing-account login,
  business details, QR resolution, location editing, review generation and persistence.
- Keep integration/E2E fixtures pointed at disposable databases. The repository's integration
  suite deletes test data and must never target production.

## Official references

- [Supabase connection methods](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Drizzle integration](https://supabase.com/docs/guides/database/drizzle)
- [Data API access controls](https://supabase.com/docs/guides/api/securing-your-api)
- [Data API exposure changes](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically)

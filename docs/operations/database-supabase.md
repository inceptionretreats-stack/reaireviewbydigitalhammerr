# Supabase database deployment

> **Status: current runbook plus historical evidence.** This file mixes the live database runbook
> with the record of the 23 September 2026 cutover from Neon. Table, row and migration counts are
> snapshots from that cutover (and the 24 September addition), not current values; check
> `packages/db/drizzle/meta/_journal.json` and the database itself before relying on them.

## Current additive migration — 24 September 2026

The Digital Hammerr Ai Review Free project `vouqzekpujgzsplhqqor` remains the production
database. Google vendor sign-in added migration `0008_bent_darkstar`, bringing the private
Drizzle journal to **nine** applied entries. It makes `users.password_hash` nullable for
Google-only vendors and adds `google_identities`; the latter has RLS enabled and no `anon`,
`authenticated`, or `service_role` Data API `SELECT` grant. The migration and lock-down were
applied over certificate-verified TLS, without refreshing, resetting, or deleting customer
data. The 23 September counts below describe the original cutover, not the current schema.

## Production promotion — 23 September 2026

**The Supabase-backed deployment `dpl_8VTibmWMkzGMBfXBdkjMHUHtxGnU` was promoted to the
canonical production site at approximately 09:57 UTC. All ten public HTTP checks passed afterward.**
The candidate's ten HTTP checks also passed before promotion. The application/API remains on the
existing Inception Vercel project, `ai-review-dh`; the hosting account was not changed.

**The target now contains production customer data. Do not rerun rehearsal restore,
target-refresh, or finalization scripts against it.** The original Neon database remains fenced.
Do not reopen it or promote an old Neon-backed deployment as a rollback after Supabase accepts
writes. Stop target writes and reconcile post-cutover data through a separately reviewed recovery
plan first. The old maintenance deployment `dpl_Cbw1U7B99Z7LBeXaCNiJ66dgdjwG` is historical,
not the promoted application deployment.

The verified **Digital Hammerr** organization (`fmqzifenquuoysefzfui`) and its **Ai Review**
project (`vouqzekpujgzsplhqqor`) remain on **Free**, in Mumbai (`ap-south-1`). Ownership was
confirmed in the intended signed-in account; no paid resource or additional project was added.
Reconfirm the intended organization/project before any future cloud or database write. The
connector exposed an unrelated account during setup; that is not authorization to use its projects.

The target runs PostgreSQL 17.6. It has 38 public tables (including analytics partitions and
`maintenance_jobs`), the private Drizzle journal, and eight applied migrations: **39 tables total**.
`pgcrypto` remains in `extensions`; restored column types use `citext` in `public`. The dashboard
reconfirmed the Data API is disabled and SSL enforcement is enabled. Both the shared session
pooler (5432) and transaction pooler (6543) passed connection checks with hostname/certificate
verification using the official Supabase CA; TLS verification was not disabled.

The shared session pooler is `aws-0-ap-south-1.pooler.supabase.com:5432`, using database
`postgres` and user `postgres.vouqzekpujgzsplhqqor`. It supports IPv4 without a paid add-on.
The Git-ignored `.env.supabase.local` contains connection metadata and the owner-supplied
database credential. Its local ACL is restricted to the current Windows user and SYSTEM.
It is a migration-input file, **not** an application env file. Production uses the separately
updated Vercel server-only database variables. Never log or commit credentials; coordinate any
credential rotation across the live runtime and migration connection instead of changing one alone.

The Vercel app/API remains under the existing Inception account, with
https://ai-review-dh.vercel.app and the owner-specified public subdomain
https://aireview.digitalhammerr.com. The public subdomain passed all ten HTTP checks after
promotion, and the Vercel project's production target was confirmed as
`dpl_8VTibmWMkzGMBfXBdkjMHUHtxGnU`. This cutover did not change DNS; email sender-domain/DNS
verification remains a separate paused task. The Vercel account name does not determine Supabase ownership.

Only six production database variables changed: `DATABASE_URL`, `DIRECT_DATABASE_URL`,
`DATABASE_SSL`, `DATABASE_SSL_ROOT_CERT`, `DATABASE_POOL_MIN`, and `DATABASE_POOL_MAX`.
Non-database production variables and development/preview variables were preserved, including
the custom authentication/encryption secrets. Non-production `DATABASE_URL` still points at the
fenced Neon database; those previews need a future, explicitly scoped configuration decision.
Do not reopen the old production database to make a development/preview environment work.

### Final fenced backup and verified target

The final access-restricted backup is outside the repository:

`C:/Users/digital hammerr/Downloads/ai-review-private-backups/2026-09-23-supabase/2026-09-23T09-51-12-621Z-ed082ab3`

- Archive: `source-public-drizzle.dump`, SHA-256
  `320d8c6fdad3116f19850ad16fca4afe8c2c6723a972faeb7e55998dcea22617`.
- The source snapshot contained nine accounts, five businesses, 38 public/journal tables,
  287 physical rows and seven migrations. All 37 original public-table row hashes and original
  public sequence states were preserved. Custom accounts, passwords and sessions were not converted
  to Supabase Auth or reset.
- A fresh backup was taken while application writes were blocked, then the source was durably
  closed and drained. `source-fence.journal.jsonl` ended with `readyForRestore: true`, and
  `source-fenced-final-manifest.json` matched the backup's `source-manifest.json`.
- The source control database independently confirmed `datallowconn=false` and zero application
  clients. The pooled probe timed out; that was accepted only with the independent closed/drained
  control-database proof and tested timeout classification. **A timeout alone is not a fence.**
- The dedicated target was refreshed atomically, then the actual migration runner applied only
  `0007_maintenance_jobs` and target-only hardening. Final verification found 288 physical rows,
  39 tables and eight correct migration hashes/timestamps, retaining the original seven-entry
  journal prefix. `maintenance_jobs` was empty at verification; the extra physical row is the
  new migration journal entry.
- All 39 tables have RLS. API roles have zero table, column, sequence and journal-schema grants.
  Original row hashes, sequence states, table/sequence inventories and analytics partition
  primary-key parent metadata passed verification. The narrow PostgreSQL-version differences
  reviewed during rehearsal remain documented below; schemas are not claimed byte-identical.
- Private final reports include `target-security.json`, `target-hardened-manifest.json` and
  `hardened-verification.json`. `cutover-completion.json` records the completed promotion and
  public HTTP verification. They are operational evidence, not deployment assets.
- Actual read-only application resolvers passed for all five existing QR codes and all five
  primary slugs. The runtime database adapter passed verified TLS plus temporary-table
  write/read/rollback on port 6543; no persistent test customer was created.
- Before promotion, ten candidate HTTP checks passed: homepage/signup/login returned 200,
  invalid signup returned 422, an unknown QR returned 404, and all five saved QR routes returned 200. All ten checks passed again on the public site after promotion. The full offline suite
  passed **1,526 tests across 93 files**; the migration guard checked all eight migrations with the known
  manually managed analytics-partition modeling warning.

Public HTTP QR checks created ordinary anonymous-session and scan records on Supabase. The
target has therefore accepted writes after the verified snapshot: **a direct rollback to Neon
would omit those writes and is not safe**. Snapshot counts above are not current live totals.

These checks did not create a new account, authenticate an existing user, generate an Ai review,
charge/refund a payment, or establish email delivery. Email-domain/DNS work remains paused.
Do not describe the database cutover as complete end-to-end testing of every integration.

### Historical source observations

The **17 September 2026** read-only production inventory found seven applied Drizzle migrations,
37 public tables including partitions, 7 users, 5 businesses, 2 customers, 5 QR codes, 11 Ai
generations and 7 payment records. These are historical counts, not current cutover verification.
The local development database has different data and must not replace production.

A fresh read-only source probe on **23 September 2026** verified PostgreSQL 18.6,
11,427,840 database bytes, 37 public tables and seven applied migrations. No source records
were modified. These metadata checks are not a backup, data reconciliation or cutover approval.

### Historical restore rehearsal and private backup

After the user changed networks, Neon and the official PostgreSQL client download became
reachable. PostgreSQL 18.6 `pg_dump`, `pg_restore` and `psql` were downloaded from EnterpriseDB's
official Windows binary distribution and run portably. ZIP integrity and client versions were
verified; no installer, Windows service or PATH change was used. The executables are unsigned;
this is vendor provenance plus archive integrity, not an Authenticode assertion. Local provenance
is recorded in `tmp/tools/postgresql-18.6-4-portable/PROVENANCE.md`.

The earlier rehearsal backup is outside the repository; **it is not the final cutover backup**:

`C:/Users/digital hammerr/Downloads/ai-review-private-backups/2026-09-23-supabase/2026-09-23T09-06-57-578Z-561bbea4`

- Archive: `source-public-drizzle.dump`, SHA-256
  `a15e4984eab3f7a519159c3c04b1f4783049ef5c7f5aaa299660f1481fed487d`.
- `source-manifest.json` and the archive share one exported read-only repeatable-read snapshot.
  The snapshot has 38 public/drizzle tables, 287 physical rows, nine users, five businesses and
  seven applied migrations. All source migration timestamps/hashes match repository SQL.
- The full app schema/data restored atomically into the previously empty dedicated target,
  with no dump/restore warnings. Only the existing `public` schema's creation/comment were
  excluded from the archive list. Supabase-managed schemas were untouched.
- Before further migrations/hardening, **all table counts and row digests, all four sequence
  states, and all seven migration entries matched**. Raw evidence is retained in
  `target-restored-manifest.json` and `restore-comparison.json`.
- The actual migration runner then applied only `0007` (`maintenance_jobs`); all eight
  recorded hashes/timestamps were verified. The deployment permissions script was applied.
- RLS is enabled on all 39 public/drizzle tables. API roles `anon`, `authenticated` and
  `service_role` have no table or sequence access. Actual role-switched SELECT tests against
  users and the journal all returned permission denied. Future analytics partition protection
  was tested in a transaction and rolled back. No invalid/unready application indexes remain.
- The actual `createDatabase` adapter passed verified TLS and temporary-table
  insert/read/rollback through transaction-pooler port 6543. No test customer record was kept.
- Security Advisor was rerun: **zero errors**, one `citext`-in-public warning, and 38
  RLS-without-policy informational notices. These are retained deliberately: restored columns
  depend on `public.citext`, the Data API is off, and the app's existing server-side/custom-auth
  access model does not use browser-role RLS policies. Do not add permissive policies to clear
  the notices. This does not mean the advisor has zero findings.
- The inventory, connection, migration and permissions suites passed **67 offline tests**.

`scripts/supabase/inventory.mjs` records digests/metadata without logging customer rows.
Operational helpers are in ignored `tmp/supabase/`; never print restored SQL or secret env files.
**Do not rerun `restore.mjs` against the live target.** The source was still writable at this
earlier rehearsal checkpoint, so that copy was not promoted. The fresh fenced backup above
superseded it for the final cutover; retain this section as historical evidence only.

### Reviewed PostgreSQL compatibility differences

The strict comparison intentionally reports structural differences; it has not been weakened
to declare different schemas identical. These narrowly reviewed exceptions apply to this copy:

- PostgreSQL 18 records 248 named NOT NULL constraints; 17 records enforcement on columns.
  All 394 columns and all 248 nullability flags match. No nullability restriction was dropped.
- Four `analytics_events_*` child primary keys have `connoinherit` false → true because the
  dump creates them standalone before attaching them. Keys, partition bounds and attached
  valid/ready unique indexes match. This is a restore creation-path artifact, not a blanket
  PostgreSQL-version exemption.
- Three CHECK expressions have equivalent deparsed casts: refund status
  (`REQUESTED`, `PENDING`, `PROCESSED`, `FAILED`), reminder kind (`T30`, `T7`, `T1`, `EXPIRED`),
  and activity outcome (`SUCCESS`, `FAILURE`, `DENIED`). The allowed literals are unchanged.
- Source uses built-in `C.UTF-8` locale and citext 1.8; target uses ICU `en-US` and citext 1.6.
  They are **not fully Unicode-equivalent**: synthetic dotted-capital-I (`İ`) lookup differs.
  All nine existing user emails and five slugs are ASCII, and case-insensitive lookups match.
  Current signup/login email validation and slug validation restrict these identifiers to ASCII.
  Future Unicode email support or imports require explicit compatibility review. No stored
  user values or collations were silently rewritten.
- Source pgcrypto 1.4/public becomes target pgcrypto 1.3/extensions. The app hashes passwords
  with Node Argon2id and uses built-in `gen_random_uuid`; no app dependency on public-qualified
  pgcrypto functions was found. The two application function bodies and trigger matched before
  intentional target-only search-path/partition hardening.

### Maintenance and recovery safeguards

The user approved the brief maintenance window and production database switch. The implemented
server-only `MIGRATION_MAINTENANCE=1` gate uses a comprehensive `/:path*` matcher in
`apps/web/proxy.ts`. It returns 503/no-store with `Retry-After: 120` for pages, API requests,
Server Actions, cron, webhooks and prefetch requests before application handlers run. Only
generated `/_next/static/` GET/HEAD requests without a Server Action header pass. The gate is
off by default; the promoted normal deployment is distinct from the historical maintenance
deployment. Gate and ingress regression tests passed 68 cases.

Pausing only HTTP writes is insufficient: QR entry GETs, session resolution, QR downloads,
scheduled jobs and workers can write too. A gate cannot drain already-running callbacks or
independent workers and cannot protect old deployment URLs by itself. The durable Neon database
fence remains necessary; a read-only default or advisory lock alone is not a reliable fence for
privileged credentials. Keep the control-database recovery route private and do not automatically
reopen the source on an error.

If a post-cutover problem occurs, pause target writes first and inspect the exact deployed
version/configuration. Do not rerun the final refresh, use the stale rehearsal backup, run a
development seed, or simply reconnect the app to Neon. Once target writes exist, rollback requires
reconciliation and explicit approval. No root schema, Supabase-managed schema, extension or broad
`CASCADE` operation is authorized by this runbook. `lock-down.sql` has its own transaction and
must run separately from a restore transaction after any approved pending migrations.

The current repository contains **eight migrations (`0000`–`0007`) and 34 declared application
tables**, including `maintenance_jobs`. Monthly analytics partitions are additional physical
tables, not separate Drizzle schema declarations. The permissions script covers the declared
tables and discovers analytics partitions dynamically; its unit test compares the allowlist
with the current schema exports so new application tables cannot silently be omitted.

## Architecture

The existing Next.js API, custom login/session system and business access checks stay on Vercel.
Supabase hosts PostgreSQL. Drizzle uses a private server connection; no Supabase service key or
database password belongs in browser code. Supabase Auth is not used: existing accounts are
in `public.users`, not `auth.users`. Do not add `auth.uid()` policies to these tables.

Redis, email, Ai provider credentials, payment configuration and scheduled tasks remain separate
services. A database move does not configure those services.

## Historical setup procedure — not instructions to reprovision the live target

1. Verify the Digital Hammerr account and intended organization with the user-approved signed-in
   session. Use a dedicated project for Ai Review; do not reuse another application's project
   or infer the target from a historical account name or unrelated connector.
2. Start on the Free plan as requested. Check current free-project eligibility, database size,
   backup and inactivity limitations before provisioning; do not enable paid add-ons without
   approval. Select a region near the actual Vercel deployment runtime, not just an old runbook.
3. From the project's Connect dialog, store two secret connection strings:
   - `DATABASE_URL`: shared transaction pooler, port 6543, for Vercel.
   - `DIRECT_DATABASE_URL`: direct connection or shared session pooler, port 5432, for migrations.
     The session pooler supports IPv4 without an add-on.
4. Set `DATABASE_POOL_MIN=0`, `DATABASE_POOL_MAX=1`. Use TLS; prefer verified TLS with the
   project CA. The shared connection helper applies the same explicit TLS settings to migrations.
5. This app uses the node-postgres Drizzle adapter and unnamed queries. Do not add the
   Postgres.js-only `prepare: false` option.
6. Disable the Supabase Data API **before importing customer data**. This server-only app does
   not need REST/GraphQL access, Supabase browser keys, a new SDK or a Supabase Auth conversion.

## Historical migration procedure — do not rerun against the live target

1. Recheck source and target PostgreSQL versions. The source was previously PostgreSQL 18;
   repository CI tests PostgreSQL 17, but that does not prove a PostgreSQL 18 dump will restore
   on 17. If the target is an older major version, rehearse and verify the full restore in a
   disposable target before scheduling cutover. Do not ignore restore errors or assume a
   downgrade is supported because the application DDL looks compatible.
2. Take a consistent, access-restricted backup of the production Neon database using PostgreSQL
   client tools at least as new as the source server. Keep the original database intact. Store
   backups outside the repository; never commit dumps or credentials. Restore only the app's
   `public` and `drizzle` objects/data into an empty target; exclude source ownership and grants.
   Do not replace Supabase's `auth`, `storage`, `realtime` or other managed schemas. Verify
   `pgcrypto` and `citext` availability and extension schema/search-path placement. Keep the Data
   API disabled throughout import and hardening.
3. Preserve migration history when restoring schema and data. Do not separately replay migrations
   already recorded in the restored journal. Compare it with the repository journal and run only
   unapplied migrations before hardening (an older seven-migration source still needs `0007`).
   Alternatively, migrate a fresh target then import data with dependency/identity handling;
   choose one approach and verify it.
4. Preserve the production `HASH_PEPPER`, `APP_ENCRYPTION_KEY`, and `SESSION_SECRET` exactly.
   Do not run the development seed against existing production records.
   Vercel environment exports can contain `[SENSITIVE]` placeholders. They are not secret backups:
   never upload those placeholders or replace unrelated live settings from an exported file.
5. Apply `scripts/supabase/lock-down.sql` to the dedicated target as the app table owner after
   import and pending migrations. It enables RLS and removes API-role grants; it deliberately
   adds no Supabase Auth policies. Run Supabase security advisors. This is a deployment-only
   script, not a Drizzle migration, and must not run against the existing Neon source.
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
The current `.env.supabase.local` contains migration metadata, not ready-to-run application
variables. First prepare a separate ignored runtime file with `DIRECT_DATABASE_URL`,
`DATABASE_SSL=verify-full` and `DATABASE_SSL_ROOT_CERT` (PEM content) for the verified target.
From the repository root, using that explicitly prepared file:

```powershell
node --env-file=.env.supabase.runtime.local --run db:migrate
```

Reapply the server-only permissions script after adding tables. It requires an explicit table
allowlist update when new app tables are introduced, and fails when the expected schema is absent.
The analytics partition function included in that script applies RLS and removes API-role grants
on future monthly partitions too.

Before applying permissions, run the offline schema-coverage regression test:

```powershell
pnpm exec vitest run scripts/supabase/__tests__/lock-down.test.ts
```

This verifies the source allowlist without connecting to a database. It does not replace target
permission checks or a restore rehearsal.

## Verification

- Check the connection target and actual client TLS socket without logging credentials.
  A proxy can terminate TLS before PostgreSQL; `pg_stat_ssl` alone is not proof of client TLS.
- Compare source and target data as above; check all eight repository migration entries (or the
  current journal if more have been added) and their hashes, not just the historical source count.
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
- [Migrating PostgreSQL to Supabase](https://supabase.com/docs/guides/platform/migrating-to-supabase/postgres)
- [PostgreSQL dump version compatibility](https://www.postgresql.org/docs/18/app-pgdump.html)
- [Supabase plan limits](https://supabase.com/pricing)

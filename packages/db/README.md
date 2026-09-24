# @ai-review/db — schema, connection and migrations

This package is the PostgreSQL layer: the Drizzle table definitions, the connection pool factory
and the SQL migrations. Read it before adding a table or column, writing a migration, or running
migrations against any database. PostgreSQL 17 or newer is required (the partitioned
`analytics_events` table uses an identity column that older versions reject); the local dev
database from `pnpm db:dev` is PostgreSQL 18.

## Exports

- `@ai-review/db` (`src/index.ts`): `createDatabase(config)`, the `Database` type,
  `createPoolConfig`, `migrationDatabaseConfig`, the `schema` namespace, and every table, enum and
  row type.
- `@ai-review/db/schema` (`src/schema/index.ts`): table and enum definitions only, without the
  `pg` pool. Use it where nothing may connect, such as offline tests.

`createDatabase` opens one `pg` pool per process and returns a Drizzle client with
`casing: 'snake_case'`, so camelCase properties in TypeScript map to snake_case columns. TLS is
decided per host in `src/connection.ts` (local hosts default to no TLS, others to `require`,
overridable with `DATABASE_SSL` and `DATABASE_SSL_ROOT_CERT`).

## Schema by domain

All in `src/schema/`, re-exported from `src/schema/index.ts`.

| File             | Tables                                                                                                                  |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `enums.ts`       | All `pgEnum`s (roles, statuses, draft language, link type, payment status…) and the `citext` type                       |
| `identity.ts`    | `users`, `sessions`, `password_reset_tokens`, `user_invites`, `mfa_recovery_codes`, `google_identities`                 |
| `business.ts`    | `businesses`, `business_slugs`, `business_links`, `review_destinations`, `assets`                                       |
| `qr.ts`          | `qr_codes`, `anonymous_sessions`                                                                                        |
| `ai.ts`          | `ai_business_contexts`, `review_modes`, `ai_prompt_versions`, `ai_generations`                                          |
| `billing.ts`     | `subscriptions`, `payments`, `payment_refunds`, `subscription_reminders`, `payment_webhook_events`, `invoice_sequences` |
| `crm.ts`         | `customers`, `private_feedback`, `review_request_templates`, `review_requests`                                          |
| `domains.ts`     | `custom_domains`                                                                                                        |
| `analytics.ts`   | `analytics_events` (partitioned, see below), `analytics_daily_business`                                                 |
| `platform.ts`    | `platform_settings`, `feature_flags`, `admin_audit_logs`, `user_activity_logs`                                          |
| `maintenance.ts` | `maintenance_jobs` (resumable cursors for the Vercel Cron maintenance run)                                              |

## Migrations

SQL migrations live in `drizzle/` (`0000_initial_schema.sql` to `0009_hot_path_indexes.sql` at
the time of writing), with Drizzle's journal and snapshots in `drizzle/meta/`. Applied migrations
are recorded in the database table `drizzle.__drizzle_migrations`.

- **Never edit a migration that has been applied anywhere.** Write a new one.
- **Hand-written DDL.** `0000` creates `analytics_events` with `PARTITION BY RANGE (occurred_at)`,
  a default partition and the `ensure_analytics_events_partition()` function. drizzle-kit cannot
  model partitioning, so its snapshot describes an ordinary table, and a generated migration can
  try to drop or re-create it. `0003` adds a trigger by hand as well.
- **Migration guard.** `pnpm check:migrations` runs `scripts/db/check-migrations.mjs`, which fails
  if any migration after `0000` touches `analytics_events` or if `0000` loses its partition DDL.
  CI runs it. Review every generated migration by hand before committing it.
- **New tables** must also be added to the allowlist in `scripts/supabase/lock-down.sql`;
  `scripts/supabase/__tests__/lock-down.test.ts` (part of `pnpm test`) fails until you do.

## Commands

Run from the repository root.

| Command                              | Runs                   | Database                                        |
| ------------------------------------ | ---------------------- | ----------------------------------------------- |
| `pnpm db:generate`                   | `drizzle-kit generate` | None: diffs `src/schema` against `drizzle/meta` |
| `pnpm db:migrate`                    | `tsx src/migrate.ts`   | `DIRECT_DATABASE_URL`, else `DATABASE_URL`      |
| `pnpm --filter @ai-review/db studio` | `drizzle-kit studio`   | `DIRECT_DATABASE_URL`, else `DATABASE_URL`      |

`drizzle.config.ts` (used by `generate` and `studio`) and `migrationDatabaseConfig()` in
`src/connection.ts` (used by `migrate`) both prefer `DIRECT_DATABASE_URL`.

`DIRECT_DATABASE_URL` exists for hosts whose `DATABASE_URL` goes through a transaction pooler;
migrations need a direct or session connection. The migration runner uses a single connection.

None of these commands read `.env` on their own. Load it explicitly, and check which database it
points at first:

```sh
node --env-file=.env --run db:migrate
```

Migrations run as a deliberate release step, never on app start-up. See
[docs/operations/database-supabase.md](../../docs/operations/database-supabase.md) before touching
a hosted database.

## Tests

- `src/__tests__/connection.test.ts`, `src/__tests__/migrate.test.ts`: unit tests (`pnpm test`).
- `src/__tests__/integration/migration.test.ts`: checks that an already-migrated database has the
  extensions, tables and hand-written DDL. Run `pnpm db:migrate` first, then
  `pnpm test:integration`, against a disposable database only.

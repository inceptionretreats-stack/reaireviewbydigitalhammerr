# scripts/ — developer and operator tooling

This folder holds the command-line tools around the app: starting the local stack, seeding and
guarding the database, operator actions on live data, rendering marketing video, generating code
and hardening a hosted database. Read the table for a folder before running anything in it; the
**Changes data?** column says what each script can alter.

Run every script **from the repository root**. Several resolve `.env`, `.pgdata/` or
`packages/db/drizzle` relative to the current directory. Use the root `package.json` alias where
one exists. Scripts that import `@ai-review/core` or `@ai-review/db` run through `tsx`, because
those packages are TypeScript source.

Most scripts do **not** load `.env` themselves; the tables say which ones do. For the rest, start
the command with `node --env-file=.env`, and check which database `DATABASE_URL` points at first.
The step-by-step local setup is in
[docs/operations/local-development.md](../docs/operations/local-development.md).

## dev/ — local stack

| Script         | What it does                                               | How to run                       | Changes data?                                          |
| -------------- | ---------------------------------------------------------- | -------------------------------- | ------------------------------------------------------ |
| `dev-db.mjs`   | Local PostgreSQL 18 (`embedded-postgres`) on port 5432     | `pnpm db:dev`                    | Local `.pgdata/` cluster only                          |
| `dev-up.mjs`   | Starts database, tunnel and `next dev` detached; migrates  | `pnpm dev:up`, `pnpm dev:status` | **Yes**: migrates the `.env` database, rewrites `.env` |
| `dev-down.mjs` | Stops everything `dev:up` started                          | `pnpm dev:down`                  | No data; kills processes (see below)                   |
| `tunnel.mjs`   | Cloudflare quick tunnel so a phone can scan local QR codes | `pnpm tunnel [port]`             | Rewrites `APP_BASE_URL`, `API_BASE_URL` in `.env`      |

- `dev-db.mjs` keeps its data in `.pgdata/` and creates new clusters as UTF-8. Stop it with
  `node scripts/dev/dev-db.mjs stop`.
- `dev-up.mjs` starts each process detached with logs and state in `.dev/`, opens the tunnel
  before the web server (the server reads `APP_BASE_URL` once at boot), runs pending migrations
  against `DIRECT_DATABASE_URL` or `DATABASE_URL` from `.env`, and warms the first routes.
  `pnpm dev:up --restart-web` restarts the web server after an `.env` edit. On Windows it may flush
  the DNS cache.
- `dev-down.mjs` on Windows also kills any process listening on port 3000 and every
  `cloudflared.exe`, whoever started them.
- `tunnel.mjs` needs `cloudflared` on `PATH`. The URL changes every run, so QR codes printed in an
  earlier session stop working.
- None of these start Redis; the web app then falls back to an in-process rate limiter.

## db/ — database tooling

| Script                   | What it does                                                     | How to run                        | Changes data?                    |
| ------------------------ | ---------------------------------------------------------------- | --------------------------------- | -------------------------------- |
| `check-migrations.mjs`   | Guards the hand-written `analytics_events` partition DDL (CI)    | `pnpm check:migrations`           | No (reads files only)            |
| `seed.ts`                | Upserts the demo tenant and an ACTIVE prompt version             | see below                         | **Yes**: demo rows and passwords |
| `db-reencode.mjs`        | Moves a non-UTF-8 local database to UTF-8, keeping a backup      | `pnpm db:reencode` (loads `.env`) | **Yes**, unless `--check`        |
| `prompt-versions/*.json` | Prompt versions newer than the frozen spec's 1.0.0, for the seed | Data file                         | No                               |

Seeding reads `docs/spec/20_Test_Data_Seed.json` and the prompt files. It needs `DATABASE_URL`
and `HASH_PEPPER`:

```sh
node --env-file=.env --run seed
node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/db/seed.ts --force
```

It refuses when `NODE_ENV=production` (`--force` does not lift that) and refuses when the database
holds businesses other than the demo tenant unless you pass `--force`. It never deletes rows.
`SEED_OWNER_PASSWORD` and `SEED_ADMIN_PASSWORD` override the demo credentials.

`pnpm db:reencode --check` only reports the encoding. Without it the script copies every table
into a new UTF-8 database, swaps the two by rename, and leaves the old one as
`<name>_win1252_backup`.

Migrations are run with `pnpm db:migrate`; see [packages/db](../packages/db/README.md).

## ops/ — operator actions

> **Warning: these scripts act on whatever database `DATABASE_URL` points at, including
> production.** They change real accounts, the live Ai model and real payments. Confirm the target
> before running, and rehearse on a disposable database.

| Script                    | What it does                                                   | How to run            | Changes data?                              |
| ------------------------- | -------------------------------------------------------------- | --------------------- | ------------------------------------------ |
| `create-admin.mjs`        | Creates or updates a `SUPER_ADMIN` account, audited            | `pnpm admin:create …` | **Yes**: can overwrite a password          |
| `set-ai-model.mjs`        | Points the ACTIVE prompt version at another model              | `pnpm ai:model …`     | **Yes**: live model changes at once        |
| `reconcile-payment.mjs`   | Settles a payment Razorpay captured but the app never recorded | see below             | **Yes**: can mark paid, invoice, grant Pro |
| `mark-payment-failed.mjs` | Closes abandoned checkouts (CREATED/AUTHORIZED) as FAILED      | see below             | **Yes**: changes payment status            |

```sh
# Loads .env. Sets role, name and password; --totp-secret <base32> arms MFA directly.
pnpm admin:create --email you@example.com --password '…' [--name '…'] [--reason '…']

# Loads .env itself. --show is read-only.
pnpm ai:model <model-id> [--effort <value>]
pnpm ai:model --show

# Need DATABASE_URL; reconcile also needs RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET and calls Razorpay.
node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/ops/reconcile-payment.mjs --payment <payments.id> --reason '…'
node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/ops/mark-payment-failed.mjs --reason '…' <payments.id> [...]
```

`create-admin.mjs` hashes with `HASH_PEPPER` (and seals the TOTP secret with
`APP_ENCRYPTION_KEY`), so run it with the same values the app uses or the sign-in will fail. The
payment scripts act as the SYSTEM actor and write audit rows with your reason.

## media/ — marketing video renderers

| Path                           | What it does                                  | How to run                                       | Changes data?                                    |
| ------------------------------ | --------------------------------------------- | ------------------------------------------------ | ------------------------------------------------ |
| `render-hero-walkthrough.mjs`  | Renders the hero walkthrough video            | `node scripts/media/render-hero-walkthrough.mjs` | Writes `apps/web/public/marketing/`              |
| `render-how-it-works.mjs`      | Renders the three "how it works" clips        | `node scripts/media/render-how-it-works.mjs`     | Writes `apps/web/public/marketing/how-it-works/` |
| `hero-review-walkthrough.html` | Animated source for the hero video            | Not run directly                                 | No                                               |
| `how-it-works-clips.html`      | Animated source for the clips                 | Not run directly                                 | No                                               |
| `assets/`                      | Source art (PNG) and the caption source (VTT) | Not run                                          | No                                               |

Both renderers take `--preview` (a few PNGs in the OS temp folder, nothing written to the repo) and
`--overwrite` (required to replace existing output). They need Playwright with a browser and a
full ffmpeg build (`FFMPEG_PATH`); they install nothing. `assets/` is outside `apps/web/public`,
so it is **not deployed**; only the rendered files are.

## codegen/ — generated source

| Script                       | What it does                                               | How to run                                        | Changes data?                                         |
| ---------------------------- | ---------------------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------- |
| `generate-qr-card-fonts.mjs` | Embeds the Inter WOFF fonts for the printable QR card text | `node scripts/codegen/generate-qr-card-fonts.mjs` | Rewrites `apps/web/lib/qr/qr-card-fonts.generated.ts` |

It reads `apps/web/assets/fonts/inter-latin-600-normal.woff` and `inter-latin-800-normal.woff`.
The analytics event catalogue has its own generator; see
[packages/analytics](../packages/analytics/README.md).

## supabase/ — hosted-database cutover tooling

> **Warning: these tools act on whatever database you point them at.** `lock-down.sql` changes
> permissions on the database it is run against. Use them only as part of the runbook in
> [docs/operations/database-supabase.md](../docs/operations/database-supabase.md).

| File                  | What it does                                                           | How to run                           | Changes data?                         |
| --------------------- | ---------------------------------------------------------------------- | ------------------------------------ | ------------------------------------- |
| `inventory.mjs`       | Library: read-only manifest of schema and row-hash digests; comparison | Imported by operator code; no CLI    | No (but scans every table)            |
| `prepare-refresh.mjs` | Library: builds a reviewable reset SQL plan from manifests; offline    | Imported by operator code; no CLI    | No database access; writes plan files |
| `lock-down.sql`       | Enables RLS and revokes Supabase API-role grants on every app table    | By hand (e.g. `psql`) as table owner | **Yes**: permissions on the target    |

- `inventory.mjs` expects the caller to hold a `REPEATABLE READ READ ONLY` transaction; run it in
  a maintenance window.
- `prepare-refresh.mjs` never connects and writes its plan only to a directory outside the
  repository. The plan it produces is destructive when someone applies it.
- `lock-down.sql` has an explicit table allowlist. When you add a table to
  `packages/db/src/schema`, add it there too; `supabase/__tests__/lock-down.test.ts` fails until
  you do.

## Tests

`db/__tests__/` and `supabase/__tests__/` are unit tests that run with `pnpm test` and never
connect to a database.

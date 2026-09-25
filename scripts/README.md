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
Do not combine `--env-file` with `node --run <script>`: on Node 24 the variables do not reach the
script. The step-by-step local setup, with the exact migrate and seed commands, is in
[docs/operations/local-development.md](../docs/operations/local-development.md).

## dev/ — local stack

| Script         | What it does                                               | How to run                       | Changes data?                                     |
| -------------- | ---------------------------------------------------------- | -------------------------------- | ------------------------------------------------- |
| `dev-db.mjs`   | Local PostgreSQL 18 (`embedded-postgres`) on port 5432     | `pnpm db:dev`                    | Local `.pgdata/` cluster only                     |
| `dev-up.mjs`   | Starts database, tunnel and `next dev` detached; migrates  | `pnpm dev:up`, `pnpm dev:status` | **Yes**: runs migrations, rewrites `.env`         |
| `dev-down.mjs` | Stops everything `dev:up` started                          | `pnpm dev:down`                  | No data; kills processes (see below)              |
| `tunnel.mjs`   | Cloudflare quick tunnel so a phone can scan local QR codes | `pnpm tunnel [port]`             | Rewrites `APP_BASE_URL`, `API_BASE_URL` in `.env` |

- `dev-db.mjs` (Windows only; see
  [PostgreSQL by platform](../docs/operations/local-development.md#postgresql-by-platform)) keeps
  its data in `.pgdata/` and creates new clusters as UTF-8. Stop it with Ctrl+C in the terminal
  running `pnpm db:dev`, or with `pnpm dev:down`, which also stops the web server and tunnel.
  `node scripts/dev/dev-db.mjs stop` from another terminal stops nothing, although it prints
  "Stopped.".
- `dev-up.mjs` starts each process detached with logs and state in `.dev/`, runs pending
  migrations against `DIRECT_DATABASE_URL` or, when that is unset, `DATABASE_URL` (a variable
  exported in your shell wins over `.env`), opens the tunnel before the web server (the server
  reads `APP_BASE_URL` once at boot), and warms the first routes. `pnpm dev:up --restart-web`
  restarts the web server after an `.env` edit; it still runs the database, migration and tunnel
  steps first. On Windows it may flush the DNS cache. Because it migrates on every start, AI
  agents ask the owner before running it; see
  [approval before migrating, seeding or testing](../docs/operations/local-development.md#approval-before-migrating-seeding-or-testing).
- `dev-down.mjs` stops, with their child processes, the process IDs recorded in
  `.dev/state.json`, without checking what those processes are now: on Windows it force-kills them
  (`taskkill /T /F`); on macOS and Linux it sends SIGTERM to each one's process group. After a
  reboot, or in a copied folder, those IDs may belong to other programs; delete `.dev/state.json`
  first in that case. On Windows it also kills any process listening on port 3000 and every
  `cloudflared.exe`, whoever started them.
- `.dev/` (git-ignored) is runtime state for this machine only: `state.json` plus, for each of
  `database`, `tunnel` and `web`, a `.log` file (on Windows also `.err.log` and `.pid`). Anything
  else in it is a leftover and can be deleted. Do not delete `state.json` while the stack is
  running, because `pnpm dev:down` reads it.
- `tunnel.mjs` needs `cloudflared` on `PATH`. The URL changes every run, so QR codes printed in an
  earlier session stop working.
- None of these start Redis; the web app then falls back to an in-process rate limiter.

## db/ — database tooling

| Script                   | What it does                                                     | How to run                        | Changes data?                    |
| ------------------------ | ---------------------------------------------------------------- | --------------------------------- | -------------------------------- |
| `check-migrations.mjs`   | Guards the hand-written `analytics_events` partition DDL (CI)    | `pnpm check:migrations`           | No (reads files only)            |
| `seed.ts`                | Upserts the demo tenant and the current prompt version           | see below                         | **Yes**: demo rows and passwords |
| `db-reencode.mjs`        | Moves a non-UTF-8 local database to UTF-8, keeping a backup      | `pnpm db:reencode` (loads `.env`) | **Yes**, unless `--check`        |
| `prompt-versions/*.json` | Prompt versions newer than the frozen spec's 1.0.0, for the seed | Data file                         | No                               |

Seeding reads `docs/spec/20_Test_Data_Seed.json` and the prompt files. It needs `DATABASE_URL`
and `HASH_PEPPER`, and does not load `.env`; run it with the exact commands in
[seeding the demo tenant](../docs/operations/local-development.md#seeding-the-demo-tenant), which
also describes what it writes. It refuses when `NODE_ENV=production` (`--force` does not lift
that) and refuses when the database holds businesses other than the demo tenant unless you pass
`--force`, which is for disposable databases only. It never deletes rows. `SEED_OWNER_PASSWORD`
and `SEED_ADMIN_PASSWORD` override the demo credentials.

`pnpm db:reencode --check` only reports the encoding. Without it the script copies every table
into a new UTF-8 database, swaps the two by rename, and leaves the old one as
`<name>_win1252_backup`.

Migrations are run by `packages/db/src/migrate.ts` (`pnpm db:migrate`), not by a script here; see
[packages/db](../packages/db/README.md) and, for the exact local command,
[local development](../docs/operations/local-development.md#first-time-setup).

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

## supabase/ — hosted-database hardening (maintained) and cutover libraries (historical)

> **Warning: `lock-down.sql` changes permissions on whatever database it is run against.** Apply it
> to production only as described in
> [docs/operations/database-supabase.md](../docs/operations/database-supabase.md#keeping-lock-downsql-in-step),
> with the owner's approval.

| File                        | Status     | What it does                                                                               | How to run                                                                           | Changes data?                         |
| --------------------------- | ---------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ | ------------------------------------- |
| `lock-down.sql`             | Maintained | Enables RLS and revokes Supabase API-role grants on every app table, partition and journal | By hand with `psql`, as the tables' owner, after a migration that adds a table       | **Yes**: permissions on the target    |
| `supabase-root-2021-ca.crt` | Maintained | Supabase's public root CA certificate, for verified TLS to the hosted database             | Its PEM text goes in `DATABASE_SSL_ROOT_CERT`; `psql` takes the path (`sslrootcert`) | No (a public certificate, not secret) |
| `inventory.mjs`             | Historical | Library: read-only manifest of schema and row-hash digests; comparison                     | No CLI (see below)                                                                   | No (but scans every table)            |
| `prepare-refresh.mjs`       | Historical | Library: builds a reviewable reset SQL plan from manifests; offline                        | No CLI (see below)                                                                   | No database access; writes plan files |

- **`lock-down.sql` is part of the normal schema workflow.** It has an explicit table allowlist.
  When you add or remove a table in `packages/db/src/schema`, update the allowlist in the same
  change; `supabase/__tests__/lock-down.test.ts` (part of `pnpm test`) fails until it matches.
  After such a migration reaches production, the owner re-applies the script there.
- **`inventory.mjs` and `prepare-refresh.mjs` are libraries of the archived September 2026
  cutover.** Their only callers were the one-off cutover scripts, which are kept in the owner's
  private backup folder outside this repository and are not run again. The libraries stay here,
  with their tests, as the record of how the cutover was verified. Do not run them against the live
  database. `inventory.mjs` expects its caller to hold a `REPEATABLE READ READ ONLY` transaction and
  scans every table; `prepare-refresh.mjs` never connects, but the plan it writes is destructive
  when applied.
- Do not put unrelated scripts in this folder.

## Tests

`db/__tests__/` and `supabase/__tests__/` are unit tests that run with `pnpm test` and never
connect to a database.

## Adding a script

- **Folder by purpose:** `dev/` for the local stack, `db/` for schema and data tooling, `ops/` for
  actions on live data, `media/` for marketing renders, `codegen/` for generated source.
  `supabase/` is only for hosted-database hardening.
- **Name:** kebab-case, starting with a verb when the script does one thing (`create-admin`,
  `check-migrations`, `render-how-it-works`). A library that is imported rather than run is named
  for what it provides (`inventory`).
- **Extension:** write new scripts as `.mjs` (ESLint's scripts rules, which allow console output,
  cover only `scripts/**/*.mjs` and `.js`). A script that imports `@ai-review/core` or
  `@ai-review/db` must run through `tsx`, because those packages are TypeScript source; the three
  `ops/` scripts that do so are `.mjs` files run through `tsx`, and `db/seed.ts` is the one
  TypeScript script.
- **Header:** start with a comment giving the purpose, the exact command, what it changes and
  which variables it needs. Keep that command correct.
- **Alias:** give anything run regularly a root `package.json` alias, with `node --env-file=.env`
  built in if it needs `.env` (as `admin:create` and `db:reencode` do), and add a row to the
  folder's table above.
- **Tests** go in `scripts/<folder>/__tests__/` and must not connect to a database.

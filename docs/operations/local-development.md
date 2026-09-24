# Local development

How to run Ai Review on your own machine: what to install, how the root `.env` is used, how to
start the database and web server, how to migrate and seed, and which commands change data or
files outside your working copy. Read it before running anything in `scripts/`. For variable names
see [environment](environment.md); for tests see [testing](testing.md).

## Prerequisites

| Tool                  | Version / note                                                                                                                                                          |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node.js               | 24 or newer (`engines.node` in the root `package.json`)                                                                                                                 |
| pnpm                  | The version pinned in `packageManager` in the root `package.json` (currently 11.24.0). `corepack enable` picks it up                                                    |
| PostgreSQL            | See [PostgreSQL by platform](#postgresql-by-platform). Windows can use the bundled embedded server; macOS and Linux need their own PostgreSQL 17 or newer               |
| Redis                 | Optional locally. `REDIS_URL` must still be set (it is validated), but if nothing answers, the rate limiter falls back to a per-process memory store and logs that once |
| `cloudflared`         | Only for `pnpm dev:up` and `pnpm tunnel`, which put the local server behind a public HTTPS URL                                                                          |
| Google Chrome         | Only for the Playwright browser tests, which drive the installed Chrome                                                                                                 |
| `ffmpeg` (full build) | Only for the marketing video renderers in `scripts/media/`                                                                                                              |

### PostgreSQL by platform

- **Windows:** `pnpm db:dev` runs a real PostgreSQL 18 server from the `embedded-postgres` package.
  `pnpm-workspace.yaml` allows the install script only for `@embedded-postgres/windows-x64`; the
  Linux and macOS packages are deliberately blocked, so their binaries are never unpacked.
- **macOS and Linux:** install PostgreSQL 17 or newer yourself (Homebrew, apt, Docker, …), create
  an empty database and put its connection string in `DATABASE_URL`. 17 is the floor: the
  partitioned `analytics_events` table uses an identity column that older versions reject (see
  ADR-AMEND-C in [spec amendments](../decisions/spec-amendments.md)). CI uses PostgreSQL 17.

## First-time setup

```sh
pnpm install --frozen-lockfile
cp .env.example .env   # only when there is no .env yet; never overwrite an existing one
```

Then fill in `.env` at the repository root. The minimum to boot the web app is listed in
[environment](environment.md#required-to-boot). Leave all three Ai provider keys blank to use the
deterministic stub provider, which needs no credentials and costs nothing (it is refused in
production).

There is one `.env`, at the repository root. Who reads it:

| Reader                                                                   | How                                                                      |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| The web app (`apps/web/next.config.ts`)                                  | Loads the root `.env` at startup; variables already set are not replaced |
| `vitest.integration.config.mts`, `playwright.config.ts`                  | Load the root `.env` the same way                                        |
| `pnpm ai:model`                                                          | Loads `.env` itself                                                      |
| `pnpm admin:create`, `pnpm db:reencode`                                  | Run with `node --env-file=.env`                                          |
| `pnpm dev:up`, `pnpm tunnel`                                             | Read `.env`, and **rewrite** `APP_BASE_URL` / `API_BASE_URL` in it       |
| `pnpm db:migrate`, `pnpm seed`, the worker, `scripts/ops/*-payment*.mjs` | Do **not** load `.env`. Use `node --env-file=.env --run <script>`        |

The web server validates and caches its environment once per process, so restart it after changing
`.env`.

## Running the app

### Option A: the whole stack with one command (`pnpm dev:up`)

`pnpm dev:up` (`scripts/dev/dev-up.mjs`) starts each piece as a detached process with its own log
under `.dev/`, then exits. The processes keep running after the terminal closes. In order it:

1. **Database:** starts the embedded PostgreSQL (`scripts/dev/dev-db.mjs`) unless something already
   listens on port 5432, in which case that server is reused. On macOS and Linux, start your own
   PostgreSQL on port 5432 first so this step reuses it; `dev:down` can stop only the embedded one.
2. **Migrations:** runs `pnpm --filter @ai-review/db migrate` against `DIRECT_DATABASE_URL` or, if
   unset, `DATABASE_URL` from `.env`. A failure is logged, not fatal. This is whatever database your
   `.env` names, so make sure it is a local one.
3. **Tunnel:** runs `scripts/dev/tunnel.mjs`, which starts a Cloudflare quick tunnel (no account),
   writes the `https://…trycloudflare.com` address into `.env` as `APP_BASE_URL` and
   `API_BASE_URL`, and waits until the hostname resolves. On Windows it may flush the local DNS
   cache (`ipconfig /flushdns`). It gives up after three hostnames.
4. **Web:** starts `next dev` for `apps/web` on port 3000, restarting it whenever the tunnel address
   changed (the server reads its environment once, at boot).
5. **Warm-up:** requests `/`, `/login`, `/signup`, the demo tenant's QR page, the generate and
   events APIs and `/app`, so the first real visitor does not wait for compilation.
6. **Public check:** waits until the public URL answers, then prints it.

| Command                     | What it does                                                                                            |
| --------------------------- | ------------------------------------------------------------------------------------------------------- |
| `pnpm dev:up`               | Start or reuse database, tunnel and web server as above                                                 |
| `pnpm dev:status`           | Show whether each process is running, the listening ports and the current public URL                    |
| `pnpm dev:up --restart-web` | Restart the web server. It still runs the database check, the migration step and the tunnel check first |
| `pnpm dev:down`             | Stop what `dev:up` started (see the side-effect table below); the database files in `.pgdata/` are kept |

The tunnel URL is public: anyone with the link reaches your local app. It changes every time the
tunnel restarts, so QR codes printed under an earlier URL stop resolving. `dev:up` deliberately runs
the development server, because production mode switches off the landing-page demo QR and the
console mail transport.

### Option B: separate terminals

```sh
pnpm db:dev                                   # terminal 1 (Windows); or start your own PostgreSQL
node --env-file=.env --run db:migrate         # once, and after pulling new migrations
pnpm --filter @ai-review/web dev --hostname 127.0.0.1 --port 3000   # terminal 2
```

The app is then at `http://127.0.0.1:3000`. Every QR encodes `APP_BASE_URL`, so a QR pointing at
`localhost` opens the phone's own localhost. To scan from a phone, set `APP_BASE_URL` /
`API_BASE_URL` to this machine's LAN address or run `pnpm tunnel`, then restart the web server.

Check for an existing server before starting another one (`pnpm dev:status`, or on Windows
`Get-NetTCPConnection -LocalPort 3000,5432 -State Listen`).

## The database

`pnpm db:dev` runs `scripts/dev/dev-db.mjs start`: PostgreSQL on `localhost:5432`, database
`ai_review`, data in `.pgdata/` at the repository root. It prints the `DATABASE_URL` to use. The
data persists and is reused on the next start. Do not delete `.pgdata/` to fix a startup problem;
that destroys your local data.

New clusters are created as UTF-8. A cluster created before that change may be WIN1252, which
cannot store emoji or Devanagari; `pnpm db:reencode --check` reports the encoding and
`pnpm db:reencode` converts it (see the side-effect table).

### Migrations

Migrations live in `packages/db/drizzle/` (currently `0000_initial_schema` to
`0009_hot_path_indexes`, listed in `meta/_journal.json`). `pnpm db:migrate` runs
`packages/db/src/migrate.ts`, which uses `DIRECT_DATABASE_URL` if set and `DATABASE_URL`
otherwise.

- Never edit a migration that has been applied anywhere. Add a new one.
- After changing `packages/db/src/schema/`, generate with `pnpm db:generate`, then read both the SQL
  and the snapshot. `analytics_events` is partitioned by hand-written DDL that Drizzle cannot model,
  and `pnpm check:migrations` fails if a migration would drop or truncate it.
- Snapshot drift is already present; see [known issues](../known-issues.md).

### Seeding the demo tenant

`pnpm seed` runs `scripts/db/seed.ts`. It does not load `.env`, so run it as
`node --env-file=.env --run seed`. It needs `DATABASE_URL` and the same `HASH_PEPPER` the web app
uses (it refuses to run without one, because the seeded passwords would never verify).

What it writes, in one transaction, from `docs/spec/20_Test_Data_Seed.json`:

- a demo business owner (`demo-owner@example.com`) and a platform admin (`demo-admin@example.com`,
  with an unusable password unless `SEED_ADMIN_PASSWORD` is set);
- one Free business with the primary slug `demo-south-cafe`, its links, Ai context, review modes, QR
  codes and sample contacts;
- the ACTIVE Ai prompt version (currently 1.1.0, from `scripts/db/prompt-versions/`). Its model can
  be overridden with `AI_DEFAULT_MODEL` and `AI_REASONING_EFFORT_OVERRIDE`.

Every row has a fixed, derived ID, so running it again updates the same rows instead of adding a
second tenant. It never deletes anything. It does reset the demo owner's password on every run and
prints the owner's email and password to the console. The Google review destination is a
placeholder on `example.com` unless `SEED_GOOGLE_REVIEW_URL` supplies a validated Google link.

Two guards, in this order:

1. **`NODE_ENV=production` → refuse.** `--force` does not lift this.
2. **The database already holds a business other than the demo tenant → refuse**, unless you pass
   `--force`. `--force` lifts only this guard: the seed then adds or refreshes the demo rows next to
   the existing businesses. Use it only on a database you know is disposable.

Do not seed a database that holds real users. Reject any advice (including the older
[Vercel runbook](deploy-vercel.md)) to unset `NODE_ENV` so the seed will run against production.

## Commands with side effects

Read this table before running anything below. "Local" means the database or files your `.env`
points at, which is only local if you made it so.

| Command                                              | Consequence                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                                           | Runs `dev` in every workspace in parallel: `next dev` for the web app **and** `tsx watch` for `apps/worker`. The worker reads only exported variables; if it starts, it schedules maintenance jobs in Redis and runs them against `DATABASE_URL`. Prefer `pnpm --filter @ai-review/web dev` |
| `pnpm dev:up`                                        | Applies migrations to the database in `.env`, opens a public tunnel, rewrites `APP_BASE_URL` / `API_BASE_URL` in `.env`, may flush the Windows DNS cache                                                                                                                                    |
| `pnpm dev:up --restart-web`                          | Same database, migration and tunnel steps before the restart; not an isolated web restart                                                                                                                                                                                                   |
| `pnpm tunnel`                                        | Public URL to your machine; rewrites `APP_BASE_URL` / `API_BASE_URL` in `.env`                                                                                                                                                                                                              |
| `pnpm dev:down`                                      | On Windows also kills **any** process listening on port 3000 and **all** `cloudflared.exe` processes, not only the ones `dev:up` started                                                                                                                                                    |
| `pnpm db:migrate`                                    | Changes the schema of whichever database `DIRECT_DATABASE_URL` / `DATABASE_URL` names                                                                                                                                                                                                       |
| `pnpm seed`                                          | Upserts demo data, resets the demo owner's password, prints it. Refuses on production and on non-empty databases                                                                                                                                                                            |
| `pnpm seed --force`                                  | Seeds even when other businesses exist. Never against real user data                                                                                                                                                                                                                        |
| `pnpm db:reencode`                                   | Creates a UTF-8 copy of the database, migrates it, copies every row, swaps the two by renaming and leaves `<name>_win1252_backup` behind. `--check` only reports the encoding                                                                                                               |
| `pnpm admin:create` (`scripts/ops/create-admin.mjs`) | Creates or upgrades a SUPER_ADMIN and **overwrites the password** of an existing account with that email; writes an audit row. `--totp-secret` pre-arms MFA                                                                                                                                 |
| `pnpm ai:model` (`scripts/ops/set-ai-model.mjs`)     | Changes the model of the ACTIVE prompt version immediately, for every business using that database. `--show` is read-only                                                                                                                                                                   |
| `scripts/ops/reconcile-payment.mjs`                  | Calls Razorpay; can mark a payment captured, issue an invoice and activate Pro. Audited as SYSTEM                                                                                                                                                                                           |
| `scripts/ops/mark-payment-failed.mjs`                | Marks started/authorised payments FAILED. Audited as SYSTEM                                                                                                                                                                                                                                 |
| `scripts/supabase/*`                                 | Tooling from the September 2026 Supabase cutover. `lock-down.sql` changes grants and row-level security; `inventory.mjs` scans and hashes whole tables. Historical; do not run against the live database                                                                                    |
| `scripts/media/render-*.mjs --overwrite`             | Replaces the published marketing videos in `apps/web/public/marketing/`. Without it they refuse to replace existing files; `--preview` writes only to the OS temp folder                                                                                                                    |
| `pnpm test:integration`                              | Creates and deletes fixture rows in the `DATABASE_URL` database                                                                                                                                                                                                                             |
| `pnpm e2e`                                           | Writes directly to the `DATABASE_URL` database (resets the demo tenant's quota, payments and entitlement) and drives the running app                                                                                                                                                        |
| `pnpm format`                                        | Rewrites every file Prettier covers. In a tree with other people's changes, format only your files                                                                                                                                                                                          |

The `scripts/ops/` tools exist for operating the real service. Run them only when the owner has
asked for that specific action, against a database you have confirmed.

## Safety rules

- **Never point local tools at production data.** Before `dev:up`, `db:migrate`, `seed`,
  `test:integration` or `e2e`, check which database `DATABASE_URL` and `DIRECT_DATABASE_URL` name.
  Do not paste production variables (for example from `vercel env pull`) into the root `.env`.
- Never overwrite an existing `.env` with `.env.example`, and never commit, paste or screenshot
  `.env`, `.env.local` or `.vercel/` contents.
- With `RESEND_API_KEY` set, development sends **real email**. Without it, the console transport
  prints the first link of each email, and a password-reset or invite link printed there is live.
- With a real Ai key set, local generation calls the real provider and costs money. With Razorpay
  keys set, use test-mode keys only.
- Do not delete `.pgdata/` or drop local databases to get past an error; find the cause.
- Do not submit real Google reviews, send WhatsApp messages or email, or charge or refund money
  while testing.

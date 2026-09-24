# Ai Review by Digital Hammerr

Ai Review helps local businesses collect genuine Google reviews. A business prints a QR code; a
customer scans it, picks the services they used, gets an **editable Ai-drafted review**, confirms it
reflects their real experience, copies it, and decides whether to post it on Google themselves.

The product never posts a review, never checks whether one was posted, never asks for a star rating
and never promises more reviews. It only records what it can observe: a scan, a draft, a copy, Google
being opened.

## Who uses it

| Audience                      | What they do                                                                                                   | Where it lives                                 |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| **Visitors**                  | Read the marketing site, pricing and policies                                                                  | `apps/web/app/(marketing)`                     |
| **Business owners (vendors)** | Sign up, set up their business and Google review link, print QR codes, see feedback and analytics, pay for Pro | `apps/web/app/(auth)`, `apps/web/app/(vendor)` |
| **Customers**                 | Scan a QR or open a business page, get a draft review, or leave private feedback                               | `apps/web/app/(customer)`                      |
| **Platform admins**           | Manage businesses, payments, prompts, settings and the admin team (MFA required)                               | `apps/web/app/(admin)`                         |

## How it is built

```text
Browser (visitor / vendor / customer / admin)
        │
        ▼
apps/web ─ Next.js 16 app: pages, React components and the JSON API (/api/v1/*) in one deployable
        │
        ├─► packages/core      domain logic: Ai generation, prompts, quotas, billing, auth, tenancy
        ├─► packages/db        Drizzle schema + migrations ──► PostgreSQL
        ├─► Redis              shared rate limits (falls back to in-memory when absent)
        ├─► Ai provider        draft generation (configured by environment)
        ├─► Razorpay           Pro checkout, payments, refunds
        └─► Resend             transactional email

Vercel Cron ──► /api/cron/* ──► subscription, health and maintenance jobs
apps/worker (optional, not deployed) ──► the same maintenance jobs on BullMQ
```

TypeScript throughout: Node 24+, pnpm workspaces, Next.js 16, React 19, Drizzle ORM on PostgreSQL,
Tailwind CSS 4 with CSS Modules, Vitest and Playwright. More detail:
[architecture overview](docs/architecture/overview.md).

## Repository map

| Path                                             | What is in it                                                                                     |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| [`apps/web`](apps/web/README.md)                 | The Next.js app — all UI and the backend API. This is what gets deployed (Vercel root directory). |
| ├ [`app/`](apps/web/app/README.md)               | Routes, grouped by audience: `(marketing)`, `(customer)`, `(auth)`, `(vendor)`, `(admin)`, `api`  |
| ├ [`lib/`](apps/web/lib/README.md)               | Server and shared logic, one folder per concern (`auth`, `http`, `customer`, `ai`, `qr`, `crm`…)  |
| └ [`components/`](apps/web/components/README.md) | React UI, one folder per audience plus `shared/`                                                  |
| [`apps/worker`](apps/worker/README.md)           | Optional standalone background worker (BullMQ); not deployed                                      |
| [`packages/`](packages/README.md)                | Internal libraries: `core`, `db`, `contracts`, `config`, `analytics`, `ui`                        |
| [`scripts/`](scripts/README.md)                  | Local dev stack, database tools, operator tools, media renderers, code generation                 |
| [`e2e/`](e2e/README.md)                          | Playwright browser tests, grouped by audience                                                     |
| [`docs/`](docs/README.md)                        | Architecture, features, operations runbooks, decisions, history, and the frozen original spec     |
| [`AI_HANDOVER.md`](AI_HANDOVER.md)               | Short brief and ground rules for AI coding agents working on this repo                            |

## Getting started

You need **Node.js 24+** and **pnpm 11** (`corepack enable` picks up the pinned version).

```bash
pnpm install
cp .env.example .env          # then fill in the values you need (see docs/operations/environment.md)
pnpm dev:up                   # local database, public tunnel and dev server, each in the background
pnpm dev:status               # what is running, and the address to open
pnpm dev:down                 # stop everything
```

`pnpm dev:up` runs a local PostgreSQL (embedded; Windows binaries only — on macOS/Linux point
`DATABASE_URL` at your own PostgreSQL 17+), applies any pending migrations to the database in
`.env`, opens a Cloudflare tunnel so a phone can scan local QR codes, writes that tunnel address into
`.env` as `APP_BASE_URL`, and starts `next dev`. Because it migrates whatever `DATABASE_URL` names,
never point a local `.env` at a shared database. Full walkthrough, including seeding and which
commands touch real data: [local development](docs/operations/local-development.md).

## Common commands

| Command                                | What it does                                                          |
| -------------------------------------- | --------------------------------------------------------------------- |
| `pnpm --filter @ai-review/web dev`     | Just the Next.js dev server (you provide the database)                |
| `pnpm test`                            | Unit tests (Vitest, no database needed)                               |
| `pnpm test:integration`                | Integration tests (needs PostgreSQL via `DATABASE_URL`)               |
| `pnpm e2e`                             | Playwright browser tests (needs the dev server and a seeded database) |
| `pnpm typecheck` / `pnpm lint`         | TypeScript across all workspaces / ESLint                             |
| `pnpm format:check`                    | Prettier check, as run in CI                                          |
| `pnpm db:generate` / `pnpm db:migrate` | Create a migration from schema changes / apply migrations             |
| `pnpm --filter @ai-review/web build`   | Production build of the web app                                       |

CI (`.github/workflows/ci.yml`) runs format, lint, typecheck, the migration guard, the analytics
taxonomy check, unit tests, integration tests, the web build and a dependency audit.

## Where to go next

- **New to the codebase:** [docs index](docs/README.md) → [architecture overview](docs/architecture/overview.md)
  → [routes](docs/architecture/routes.md) → the feature doc for what you are touching.
- **Changing something:** [contributing guide](CONTRIBUTING.md) — conventions, tests, commits.
- **Deploying or operating:** [operations docs](docs/README.md#operations) — never deploy or run
  migrations without the owner's go-ahead.
- **Why something is the way it is:** [spec amendments](docs/decisions/spec-amendments.md) (the
  change record for the original spec in [`docs/spec/`](docs/spec/README_FIRST.md)) and
  [project history](docs/history/changelog.md).
- **Open problems:** [known issues](docs/known-issues.md).

## Ground rules

- Never commit secrets. The real `.env` stays local; `.env.example` lists variable names only.
- `docs/spec/` is the frozen, delivered specification — never edit or reformat it. Record changes to
  it in [`docs/decisions/spec-amendments.md`](docs/decisions/spec-amendments.md).
- Never edit an applied migration in `packages/db/drizzle/`; add a new one.
- Product wording: the brand is "Ai Review" ("Ai drafts"), and the product may only say Google was
  _opened_ — never that a review was submitted or posted. ESLint enforces the second rule.

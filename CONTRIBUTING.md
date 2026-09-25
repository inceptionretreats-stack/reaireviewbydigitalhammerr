# Contributing

How to make a change to Ai Review without breaking the product or its rules. Read the
[README](README.md) first for what the project is and how to run it.

## Before you start

- Get the stack running locally: [local development](docs/operations/local-development.md). Create
  `.env` only if there is none; never overwrite an existing one (it holds the secrets local passwords
  were hashed with).
- Read the doc for the area you are touching: [docs index](docs/README.md). The owner's approved
  product rules are in [product decisions](docs/decisions/product-decisions.md).
- `apps/web` runs Next.js 16, which differs from older versions in APIs and file conventions.
  Check the guide in `apps/web/node_modules/next/dist/docs/` before changing framework-level code
  (see [`apps/web/AGENTS.md`](apps/web/AGENTS.md)).
- **What needs the owner's approval.** Ask the project owner before generating a new migration
  (`pnpm db:generate`), and before running migrations, the seed or the database tests
  (`pnpm test:integration`, `pnpm e2e`) against any database you did not create yourself.
  `pnpm dev:up` runs migrations on every start, against `DIRECT_DATABASE_URL` when it is set and
  `DATABASE_URL` otherwise, so check both first. Also ask before anything else outside your task:
  deployments, changes to production data, provider, DNS or account changes, sending email or
  messages to real people, or anything that costs money. AI coding agents follow the stricter rule
  in [AI_HANDOVER.md](AI_HANDOVER.md#1-first-instructions) and ask before any migration.
- **Branches.** Branch from `main` and open pull requests against `main`; CI runs on pull requests
  and on pushes to `main`. If the branch you were handed is ahead of `main`, ask the owner which one
  to start from. Never push to `main`, merge or force-push without the owner's go-ahead.

## Where new code goes

| You are adding…                                            | Put it in                                                                                                                                                                                                                                            |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A page                                                     | `apps/web/app/<route group>/…/page.tsx` — pick the group by audience (see [`app/`](apps/web/app/README.md)). A new top-level URL segment must also go into `RESERVED_SLUGS` in `packages/core/src/business/slug.ts`, or a business slug can claim it |
| An API endpoint                                            | `apps/web/app/api/v1/<area>/…/route.ts`, kept thin: parse, authorise, call `lib/` or `packages/core`                                                                                                                                                 |
| Server logic used by more than one route or page           | `apps/web/lib/<concern>/` (see [`lib/`](apps/web/lib/README.md))                                                                                                                                                                                     |
| Domain logic the worker also needs, or pure business rules | `packages/core/src/<domain>/`                                                                                                                                                                                                                        |
| A request/response schema                                  | `packages/contracts/src/`, then use it in the route and document it in `docs/openapi/v1.yaml`                                                                                                                                                        |
| A database table or column                                 | `packages/db/src/schema/`. Read the [Migrations section](packages/db/README.md#migrations) of the db package first (and the warning below), then, with the owner's approval, `pnpm db:generate`. Never edit applied migrations                       |
| A vendor workspace component                               | `apps/web/components/dashboard/<screen>/` (one folder per `/app` screen; the sidebar and layout are in `dashboard/shell/`)                                                                                                                           |
| An admin console component                                 | `apps/web/components/admin/<screen>/` (`businesses`, `payments`, `team`, `activity`, `ai`, `settings`; navigation in `admin/shell/`). Only pieces several admin screens share sit at `admin/` itself                                                 |
| Any other React component                                  | `apps/web/components/<audience>/…` (`marketing`, `customer`, `auth`, `onboarding`); used by several audiences → `components/shared/`                                                                                                                 |
| A generic UI primitive (button, dialog, input)             | `packages/ui/src/`                                                                                                                                                                                                                                   |
| A script                                                   | `scripts/<dev \| db \| ops \| media \| codegen>/` plus a row in [`scripts/README.md`](scripts/README.md)                                                                                                                                             |
| A browser test                                             | `e2e/<audience>/`; a customer spec that must also run on the phone project is named `customer-*.spec.ts`                                                                                                                                             |

A helper used only by one route folder may sit next to that route (for example
`app/api/v1/qr/[id]/download/filename.ts`). Once a second place needs it, move it to `lib/`.

**Folder boundaries (enforced by ESLint).** Code in `apps/web/lib/` must not import from
`components/` or `app/`, and code in `apps/web/components/` must not import from `app/`. Tests are
exempt. If a component needs something from a route folder, move that code to `lib/`.

**Before your first `pnpm db:generate`.** `packages/db/drizzle/meta/0009_snapshot.json` is currently
a byte-for-byte copy of `0008_snapshot.json`, so the chain of snapshots that drizzle-kit compares
against is broken (see [known issues](docs/known-issues.md#database-and-code-structure)). Repair it
first, or the generated migration will be wrong. Also add any new table to the allowlist in
`scripts/supabase/lock-down.sql`; a unit test fails until you do. Delete the snapshot part of this
note once that issue is fixed.

## Conventions

- **TypeScript in strict mode** (settings in `tsconfig.base.json`), linted with typescript-eslint.
- **Imports.** In `apps/web`, `@/…` points at `apps/web` (for Next and for Vitest). Use relative
  imports inside a feature folder and `@/` across folders; between `lib/` folders that means
  `@/lib/<folder>/<module>`. Workspace packages are imported as `@ai-review/<name>`.
- **Tests sit next to the code** in `__tests__/`. Tests that need PostgreSQL go in
  `__tests__/integration/` and run with `pnpm test:integration`. See [testing](docs/operations/testing.md).
- **Styling.** CSS Modules next to the component; global styles in `apps/web/app/globals.css`;
  shared primitives in `packages/ui`.
- **Comments explain why**, and cite the spec or decision ID when a rule comes from one (for example
  `AC-025`, `AMENDMENT-029`). Those IDs are defined in `docs/spec/` and
  [`docs/decisions/spec-amendments.md`](docs/decisions/spec-amendments.md). A bare spec file name in
  a comment, such as `13_Security_Privacy_Compliance.md` or "the Decision Log"
  (`22_Decision_Log.md`), means that file in `docs/spec/`.
- **Product wording.** User-facing text says "Ai Review" / "Ai draft". The product may only say
  Google was _opened_. `pnpm lint` and CI fail on text claiming a review was submitted; they do not
  catch "posted", which only the browser tests and review catch, so check your wording. Do not add
  growth promises or claims the product cannot verify.
- **Secrets.** Never commit `.env` or any other `.env.*` file except `.env.example`, and never paste
  credentials into docs, logs, tests or screenshots. Refer to environment variables by name.
- **Generated files.** Never edit `*.generated.ts` or `pnpm-lock.yaml` by hand. Leave
  `apps/web/next-env.d.ts` alone: `next dev` rewrites its imports to `.next/dev/types/…` and
  `next build` switches them back to `.next/types/…`, so Git often shows it as modified. Do not
  commit the `.next/dev/types` version; `git restore apps/web/next-env.d.ts` or the next build puts
  it back.

## Before you open a pull request

Run everything CI runs ([the CI jobs](docs/operations/testing.md#continuous-integration)):

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm check:migrations
pnpm --filter @ai-review/analytics generate && git diff --exit-code -- packages/analytics/src/events.generated.ts
pnpm test
pnpm test:integration              # needs PostgreSQL; writes and deletes rows in the .env database
pnpm --filter @ai-review/web build
pnpm audit --audit-level high
```

`pnpm test:integration` expects its database to be migrated. `pnpm dev:up` does that on every
start; otherwise run the migrate command from
[local development](docs/operations/local-development.md#first-time-setup),
`node --env-file=.env node_modules/tsx/dist/cli.mjs packages/db/src/migrate.ts`. Do not use
`node --env-file=.env --run db:migrate`: on Node 24 it does not pass `.env` to the script. Run the
integration tests only against a database you created yourself, or ask the owner first. The
analytics step must leave no diff: the event catalogue is generated from the frozen
`docs/spec/11_Analytics_Event_Taxonomy.csv`.

**If `format:check` fails,** run `pnpm exec prettier --write <the files you changed>`. Do not run
`pnpm format`: it rewrites every file Prettier covers, including other people's uncommitted work.

For UI or flow changes, also run the relevant Playwright specs (`pnpm e2e e2e/<folder>`) and check the
screen on a phone-width viewport. The browser tests write to the database in `.env`, so run them
only against a local database you created yourself, or ask the owner first (see
[a database for tests](docs/operations/local-development.md#a-separate-database-for-tests)). When
you report results, say what you verified locally versus what was verified on a deployed site; they
are not the same.

Also:

- Update the README of any folder whose layout you changed, and the doc under `docs/` that describes
  the behaviour you changed.
- If the change departs from the original spec, add an entry to
  [`docs/decisions/spec-amendments.md`](docs/decisions/spec-amendments.md).
- Stage only the files you meant to change. Before committing, check `git status` for
  `apps/web/next-env.d.ts` and leave it out.
- Write commit messages as a short imperative summary, then a body explaining what changed and why.

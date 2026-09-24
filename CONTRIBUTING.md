# Contributing

How to make a change to Ai Review without breaking the product or its rules. Read the
[README](README.md) first for what the project is and how to run it.

## Before you start

- Get the stack running locally: [local development](docs/operations/local-development.md).
- Read the doc for the area you are touching: [docs index](docs/README.md).
- `apps/web` runs Next.js 16, which differs from older versions in APIs and file conventions.
  Check the guide in `apps/web/node_modules/next/dist/docs/` before changing framework-level code
  (see [`apps/web/AGENTS.md`](apps/web/AGENTS.md)).
- Ask the project owner before anything outside your task: database migrations against a shared
  database, deployments, provider/DNS/account changes, or anything that costs money.

## Where new code goes

| You are adding…                                            | Put it in                                                                                                   |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| A page                                                     | `apps/web/app/<route group>/…/page.tsx` — pick the group by audience (see [`app/`](apps/web/app/README.md)) |
| An API endpoint                                            | `apps/web/app/api/v1/<area>/…/route.ts`, kept thin: parse, authorise, call `lib/` or `packages/core`        |
| Server logic used by more than one route or page           | `apps/web/lib/<concern>/` (see [`lib/`](apps/web/lib/README.md))                                            |
| Domain logic the worker also needs, or pure business rules | `packages/core/src/<domain>/`                                                                               |
| A request/response schema                                  | `packages/contracts/src/`, then use it in the route and document it in `docs/openapi/v1.yaml`               |
| A database table or column                                 | `packages/db/src/schema/`, then `pnpm db:generate` to create a migration (never edit applied ones)          |
| A React component                                          | `apps/web/components/<audience>/…`; used by several audiences → `components/shared/`                        |
| A generic UI primitive (button, dialog, input)             | `packages/ui/src/`                                                                                          |
| A script                                                   | `scripts/<dev \| db \| ops \| media \| codegen>/` plus a row in [`scripts/README.md`](scripts/README.md)    |
| A browser test                                             | `e2e/<audience>/`; a customer spec that must also run on the phone project is named `customer-*.spec.ts`    |

A helper used only by one route folder may sit next to that route (for example
`app/api/v1/qr/[id]/download/filename.ts`). Once a second place needs it, move it to `lib/`.
`lib/` must not import from `components/`.

## Conventions

- **TypeScript in strict mode** (settings in `tsconfig.base.json`), linted with typescript-eslint.
- **Imports.** In `apps/web`, `@/…` points at `apps/web` (for Next and for Vitest). Use relative
  imports inside a feature folder and `@/` across folders. Workspace packages are imported as
  `@ai-review/<name>`.
- **Tests sit next to the code** in `__tests__/`. Tests that need PostgreSQL go in
  `__tests__/integration/` and run with `pnpm test:integration`. See [testing](docs/operations/testing.md).
- **Styling.** CSS Modules next to the component; global styles in `apps/web/app/globals.css`;
  shared primitives in `packages/ui`.
- **Comments explain why**, and cite the spec or decision ID when a rule comes from one (for example
  `AC-025`, `AMENDMENT-029`). Those IDs are defined in `docs/spec/` and
  [`docs/decisions/spec-amendments.md`](docs/decisions/spec-amendments.md).
- **Product wording.** User-facing text says "Ai Review" / "Ai draft". The product may only say
  Google was _opened_; ESLint fails the build on text claiming a review was submitted. Do not add
  growth promises or claims the product cannot verify.
- **Secrets.** Never commit `.env` or credentials, and never paste them into docs, logs, tests or
  screenshots. Refer to environment variables by name.

## Before you open a pull request

Run what CI runs:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration          # when you touched database code (needs PostgreSQL)
pnpm --filter @ai-review/web build
```

For UI or flow changes, also run the relevant Playwright specs (`pnpm e2e e2e/<folder>`) and check the
screen on a phone-width viewport. When you report results, say what you verified locally versus what
was verified on a deployed site; they are not the same.

Also:

- Update the README of any folder whose layout you changed, and the doc under `docs/` that describes
  the behaviour you changed.
- If the change departs from the original spec, add an entry to
  [`docs/decisions/spec-amendments.md`](docs/decisions/spec-amendments.md).
- Write commit messages as a short imperative summary, then a body explaining what changed and why.

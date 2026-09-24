# packages/ — internal workspace packages

This folder holds the six internal packages that `apps/web` and `apps/worker` build on. Read this
first when you need to know where domain logic, the database schema, API schemas, shared UI or
environment validation live, and which way imports are allowed to point.

## What these packages are

- **Private and source-only.** Every package is `"private": true` and has no build step. `main`,
  `types` and `exports` point straight at TypeScript files in `src/`.
- **ESM.** Every `package.json` sets `"type": "module"`.
- **Compiled by the consumer.** `apps/web/next.config.ts` lists all six (plus `@ai-review/worker`)
  in `transpilePackages`, so Next compiles them together with the app. The worker and the scripts
  run them through `tsx`.
- **One TypeScript baseline.** Each package's `tsconfig.json` extends the root
  `tsconfig.base.json` (strict, `noEmit`, bundler resolution). `pnpm typecheck` runs
  `tsc --noEmit` in every package.

## The six packages

| Package                | Folder                  | Holds                                                                                   | Main consumers                                                   |
| ---------------------- | ----------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `@ai-review/analytics` | [analytics](analytics/) | Typed event catalogue generated from the spec CSV, `validateEvent`, the funnel list     | `apps/web` (public events API, analytics queries), `apps/worker` |
| `@ai-review/config`    | [config](config/)       | Zod schema for environment variables, `loadEnv()`                                       | `apps/web/lib/infra/env.ts`, `apps/worker/src/config.ts`         |
| `@ai-review/contracts` | [contracts](contracts/) | Zod request/response schemas for the HTTP API                                           | `apps/web` route handlers and client-side forms                  |
| `@ai-review/core`      | [core](core/)           | Domain logic: AI drafting, quota, billing, auth, tenancy, audit, abuse, QR, rate limits | `apps/web`, `apps/worker`, `scripts/`                            |
| `@ai-review/db`        | [db](db/)               | Drizzle schema, connection pool, SQL migrations                                         | `core`, `apps/web`, `apps/worker`, `scripts/`                    |
| `@ai-review/ui`        | [ui](ui/)               | Shared React primitives and the Tailwind v4 stylesheet with the design tokens           | `apps/web` components                                            |

Each package has its own README with details.

## Dependency direction

Only one internal package depends on another: `core` depends on `db`. The rest are leaves.
Packages never import from `apps/`.

```text
analytics    config    contracts    ui    db
                                          ^
                                          |
                                         core

apps/worker  -> analytics, config, core, db
apps/web     -> all six packages, plus @ai-review/worker/maintenance
scripts/     -> core, db (root package.json devDependencies)
```

Browser code can safely import `@ai-review/ui` and `@ai-review/contracts`. Treat `core`, `db` and
`config` as server-only. A client component may use `import type` from `@ai-review/core`, but a
value import pulls `pg` and `@node-rs/argon2` into the browser bundle, because `core` has a single
entry that re-exports everything (see the note in
`apps/web/components/onboarding/BusinessStep.tsx`).

## Conventions

- **Import only through a package's `exports`.** Use `@ai-review/db`, `@ai-review/db/schema`,
  `@ai-review/ui/styles.css` and so on. Never import `@ai-review/<pkg>/src/...`; the `exports` map
  does not expose those paths.
- **Unit tests** live in `__tests__/` folders next to the code and run with `pnpm test` (root
  `vitest.config.mts`). They use pure functions and in-memory doubles only.
- **Integration tests** live under `__tests__/integration/` (today in `core` and `db`) and run
  with `pnpm test:integration` (root `vitest.integration.config.mts`). They need a real PostgreSQL
  at `DATABASE_URL` (the config loads the root `.env`), run one file at a time, and create and
  clean up fixtures. Point them at a disposable database, never a production one. See
  [docs/operations/testing.md](../docs/operations/testing.md).
- **Adding a package:** give it `"private": true`, `"type": "module"`, `main`/`types`/`exports`
  pointing at `src/`, a `typecheck` script and a `tsconfig.json` that extends
  `../../tsconfig.base.json`. Then add it to `transpilePackages` in `apps/web/next.config.ts`.

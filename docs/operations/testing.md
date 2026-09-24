# Testing

The three test suites (unit, integration, browser), what each needs, where the tests live, what CI
runs, and how to report verification honestly. Read it before adding tests or claiming a change
works. Setting up the database and dev server is covered in
[local development](local-development.md).

## At a glance

| Suite       | Command                 | Config                          | Needs                                                     | Tests live in                                       |
| ----------- | ----------------------- | ------------------------------- | --------------------------------------------------------- | --------------------------------------------------- |
| Unit        | `pnpm test`             | `vitest.config.mts`             | Nothing external                                          | `__tests__/` folders next to the code (`*.test.ts`) |
| Integration | `pnpm test:integration` | `vitest.integration.config.mts` | PostgreSQL 17+ with migrations applied, at `DATABASE_URL` | `__tests__/integration/` folders                    |
| Browser     | `pnpm e2e`              | `playwright.config.ts`          | Running dev server, migrated and seeded database, Chrome  | `e2e/`                                              |

## Unit tests

`pnpm test` runs `vitest run` from the repository root (`pnpm test:watch` keeps it running).
`vitest.config.mts`:

- includes `**/__tests__/**/*.test.ts` and `**/*.test.ts` across the whole repository;
- excludes `node_modules`, `dist`, `.next` and every `**/__tests__/integration/**` folder;
- maps `@/` to `apps/web`, exactly as `apps/web/tsconfig.json` does, so a test can import through
  the alias;
- fails when no test file is selected (`passWithNoTests: false`).

Unit tests use pure functions and in-memory doubles: no database, Redis, network or Ai provider.
Only `.test.ts` files are collected (a `.test.tsx` file would be ignored); tests beside components
exercise their plain helper modules, not rendered JSX. To run one file: `pnpm vitest run apps/web/lib/http/__tests__/csrf.test.ts`.

## Integration tests

`pnpm test:integration` runs `vitest run --config vitest.integration.config.mts`. It selects tests
**by path**, `**/__tests__/integration/**/*.test.ts`, and fails if none are found. The config
loads the root `.env` without overriding variables that are already set, runs files one at a time
(they share one schema) and allows 30 s per test and 60 s per hook.

Current locations:

- `packages/core/src/__tests__/integration/` — billing, quota concurrency, MFA, prompt versions,
  slugs, team, activity, abuse;
- `packages/db/src/__tests__/integration/` — the migration test and shared setup;
- `apps/web/lib/cron/__tests__/integration/` — the maintenance job.

They need a real PostgreSQL 17 or newer at `DATABASE_URL` with migrations applied
(`node --env-file=.env --run db:migrate` first). They create and clean up fixture rows, so point
them at a **disposable** database, never a shared or valuable one.

## Browser tests (Playwright)

```sh
pnpm e2e                                   # all specs, both projects
pnpm e2e:headed                            # same, with a visible browser
pnpm exec playwright test e2e/marketing/pricing.spec.ts --project=chrome
```

`playwright.config.ts`:

- drives the **installed Google Chrome** (`channel: 'chrome'`); no browser is downloaded;
- does **not** start a web server. Start the app first
  ([local development](local-development.md#running-the-app));
- uses `E2E_BASE_URL`, or `http://localhost:3000` when unset. For a plain-HTTP LAN address it tells
  Chrome to treat that origin as secure, so the clipboard path can be tested;
- loads the root `.env`, so a test can compare QR payloads against the real `APP_BASE_URL`;
- runs one worker, not fully parallel, with a 60 s test timeout;
- has two projects: `chrome` (Desktop Chrome, every spec) and `mobile` (Pixel 7, only files named
  `customer-*.spec.ts`). Some marketing specs set their own phone widths inside the `chrome` project.

| Folder           | Covers                                                                     |
| ---------------- | -------------------------------------------------------------------------- |
| `e2e/marketing/` | Landing page, FAQ, pricing, promo video, public information pages          |
| `e2e/auth/`      | Sign-in and sign-up layouts, Google sign-up UI                             |
| `e2e/customer/`  | QR/slug review flow, public profile, customer visuals and responsiveness   |
| `e2e/vendor/`    | Onboarding, dashboard, review location, subscription, invoice              |
| `e2e/admin/`     | Admin console, MFA, payments, team, activity                               |
| `e2e/system/`    | The subscription cron endpoint (skipped unless `CRON_SECRET` is set)       |
| `e2e/support/`   | Shared helpers: direct database fixtures, TOTP codes, marketing navigation |

What the suite expects:

- A migrated database seeded with the demo tenant (`node --env-file=.env --run seed`). Specs default
  to the slug `demo-south-cafe` and the demo owner; override with `E2E_SLUG`, `E2E_OWNER_EMAIL` and
  `E2E_OWNER_PASSWORD`.
- `e2e/support/db.ts` connects straight to `DATABASE_URL` to arrange state the UI cannot (for
  example resetting the demo tenant's free-draft counter, payments and entitlement). Run the suite
  only against a local or disposable database.
- The customer flow generates drafts; with no provider key the stub provider answers, so no real
  allowance or money is spent.

Other environment switches used by individual specs: `CRON_SECRET`, `FAQ_SCREENSHOT_DIR`,
`PRICING_SCREENSHOT_DIR`, `PUBLIC_INFORMATION_SCREENSHOT_DIR`, `VENDOR_UI_ARTIFACT_DIR`,
`RESPONSIVE_QA_SCREENSHOT`, `RESPONSIVE_DEBUG`.

Read a spec before running it. Some create data or follow external links. Do not post real Google
reviews, send WhatsApp messages or email, accept terms for a real user, or charge or refund money
from a test.

## Other checks

| Command                                       | What it checks                                                                           |
| --------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `pnpm lint`                                   | ESLint over the repository, including the AC-025 rule against "review submitted" wording |
| `pnpm format:check`                           | Prettier (print width 100). `docs/spec/` and generated files are ignored                 |
| `pnpm typecheck`                              | `tsc --noEmit` in every workspace package                                                |
| `pnpm --filter @ai-review/web typecheck`      | The web app only                                                                         |
| `pnpm --filter @ai-review/web build`          | The production Next.js build                                                             |
| `pnpm check:migrations`                       | No migration drops, truncates or drops columns of `analytics_events`                     |
| `pnpm --filter @ai-review/analytics generate` | Regenerates the event catalogue; `git diff` must then be empty                           |

## Continuous integration

`.github/workflows/ci.yml` runs on every pull request and on pushes to `main`, on Node 24, with a
newer run cancelling an older one for the same ref. Its four jobs run in parallel:

| Job                | Steps                                                                                                                                    |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Verify             | install (frozen lockfile) → format check → lint → typecheck → migration guard → analytics taxonomy regenerated with no diff → unit tests |
| Integration        | PostgreSQL 17 and Redis 7 service containers → install → `pnpm db:migrate` → `pnpm test:integration`                                     |
| Build              | install → `pnpm --filter @ai-review/web build`                                                                                           |
| Vulnerability scan | install → `pnpm audit --audit-level high`                                                                                                |

The intended order, from the delivered DevOps runbook, is format → lint → typecheck → unit →
integration → build → vulnerability scan. CI does not run the browser suite and does not deploy.

## Reporting verification honestly

Keep these apart when describing work, in chat, commits or docs:

- **Implemented locally:** the code exists in the working tree.
- **Tested locally:** name the suites and specs that ran, the database they used and the provider
  (stub or real).
- **Documented historically:** a note or runbook says it happened at some date. Re-check before
  relying on it.
- **Verified live:** checked against the deployed site, with the deployment named and the check
  described.

A green build, a passing unit suite or a healthy `/api/cron/health` response is not end-to-end
proof of sign-up, email delivery, payments or Ai generation. Say what was not tested. Test counts
from earlier releases are recorded in the [changelog](../history/changelog.md), not here.

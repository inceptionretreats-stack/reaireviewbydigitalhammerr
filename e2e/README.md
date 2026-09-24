# e2e/ — Playwright end-to-end suite

These are browser tests that drive the running app the way customers, business owners and admins
use it. Read this before running or adding an end-to-end test. The configuration is the root
`playwright.config.ts`. For all three test suites see
[docs/operations/testing.md](../docs/operations/testing.md); for setting up the database and dev
server see [docs/operations/local-development.md](../docs/operations/local-development.md).

**CI does not run this suite.** `.github/workflows/ci.yml` runs format, lint, typecheck, unit and
integration tests, the build and a dependency audit, but no Playwright. Run the relevant specs
locally when you change a user-facing flow.

## Layout

| Folder       | Covers                                                                                  |
| ------------ | --------------------------------------------------------------------------------------- |
| `marketing/` | Landing page (desktop and mobile widths), pricing, FAQ, public legal pages, promo video |
| `auth/`      | Sign-in and sign-up screens, responsive and visual checks, Google sign-up UI            |
| `customer/`  | QR/slug review flow, public business profile, customer-facing responsiveness            |
| `vendor/`    | Onboarding, dashboard, review location, subscription, invoice, mobile layout            |
| `admin/`     | Admin console: businesses, payments, team, MFA, activity log                            |
| `system/`    | Cron endpoints (`cron.spec.ts`, skipped unless `CRON_SECRET` is set)                    |
| `support/`   | Shared helpers, not tests (below)                                                       |

Helpers in `support/`:

- `db.ts`: direct PostgreSQL access to arrange state the UI cannot reach (reset the demo tenant's
  quota and entitlement, set up a paid year, clear reminders, restore owner details). It uses
  `DATABASE_URL` and falls back to the local dev database.
- `totp.ts`: an independent TOTP implementation, `signInAdmin()` (password plus MFA challenge) and
  the fixed TOTP secret the suite arms on the demo admin.
- `marketing-navigation.ts`: opens the collapsible marketing navigation on narrow screens.

## What it needs

The suite does not start anything itself. As the comment at the top of `playwright.config.ts`
says, it needs a running dev server and a migrated, seeded database:

```sh
# terminal 1: local PostgreSQL (keeps running)
pnpm db:dev

# terminal 2: schema and demo data, then the app
node --env-file=.env --run db:migrate
node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/db/seed.ts --force
pnpm --filter @ai-review/web dev

# terminal 3: the suite
pnpm e2e
```

- **Google Chrome installed.** Both projects use `channel: 'chrome'`, the locally installed
  Chrome, so no Playwright browser download is needed.
- **`.env`.** `playwright.config.ts` loads the root `.env` into the test process, so helpers see
  the same `DATABASE_URL`, `APP_BASE_URL` and `CRON_SECRET` as the dev server.
- **Admin sign-in.** `admin/admin.spec.ts` and `admin/admin-mfa.spec.ts` run
  `scripts/ops/create-admin.mjs` to give the seeded demo admin a known password and TOTP secret.
  Other admin specs assume that has happened, so run the admin folder as a whole on a fresh
  database.
- **Rate limits.** The suite repeats real flows from one address and can trip the limiter. Set
  `RATE_LIMIT_MULTIPLIER` in the local `.env` to raise the allowances; the MFA spec reads the same
  value to know where the limit sits.

**Use a disposable local database.** The suite resets the demo tenant's quota and subscription,
creates and deletes test users, and creates an admin account. Never point it at production.

## Running

| Command                                                   | Runs                                    |
| --------------------------------------------------------- | --------------------------------------- |
| `pnpm e2e`                                                | Everything, headless, both projects     |
| `pnpm e2e:headed`                                         | Everything with a visible browser       |
| `pnpm exec playwright test e2e/vendor`                    | One folder                              |
| `pnpm exec playwright test e2e/marketing/pricing.spec.ts` | One file                                |
| `pnpm exec playwright test e2e/customer --project=mobile` | One project only (`chrome` or `mobile`) |

Tests run one at a time (`workers: 1`) against `E2E_BASE_URL`, default `http://localhost:3000`.
A few specs default to `http://127.0.0.1:3000` instead, and `marketing/public-information.spec.ts`
always uses that address, so the dev server must answer on both. For a plain-HTTP address other
than localhost (for example a LAN IP), the config tells Chrome to treat that origin as secure so
the clipboard copy path can be tested. Failures keep a screenshot and a trace under
`test-results/` (git-ignored).

## Desktop and mobile projects

- **`chrome`**: Desktop Chrome viewport. Runs every spec.
- **`mobile`**: Pixel 7 viewport. Runs only files matching `customer-*.spec.ts`, because the
  customer flow is mobile-first and a QR scan happens on a phone.

Name a customer spec `customer-<something>.spec.ts` if it must also run on the phone viewport.
`customer/public-profile.spec.ts` does not match, so it runs on desktop only. Marketing and vendor
specs that check small screens set their own viewport sizes inside the `chrome` project.

## Other variables

`E2E_SLUG` (public business slug, defaults to the seeded demo), `E2E_OWNER_EMAIL` and
`E2E_OWNER_PASSWORD` (vendor specs, default to the seeded owner), and screenshot output folders:
`FAQ_SCREENSHOT_DIR`, `PRICING_SCREENSHOT_DIR`, `PUBLIC_INFORMATION_SCREENSHOT_DIR`,
`VENDOR_UI_ARTIFACT_DIR`, `RESPONSIVE_QA_SCREENSHOT`. Most are optional; the public-information
spec writes to the OS temp folder when its variable is unset.

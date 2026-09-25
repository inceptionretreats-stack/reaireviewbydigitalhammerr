# e2e/ — Playwright end-to-end suite

These are browser tests that drive the running app the way customers, business owners and admins
use it. Read this before running or adding an end-to-end test. The configuration is the root
`playwright.config.ts`. This file is the one place the folder layout and the variables the specs
read are described. For all three test suites see
[docs/operations/testing.md](../docs/operations/testing.md); for setting up the database and dev
server see [docs/operations/local-development.md](../docs/operations/local-development.md).

**CI does not run this suite** (see
[what CI runs](../docs/operations/testing.md#continuous-integration)). Run the relevant specs
locally when you change a user-facing flow.

## Layout

| Folder       | Covers                                                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `marketing/` | Landing page (desktop and mobile widths), review-opportunity section, pricing, FAQ, public information pages, promo video |
| `auth/`      | Sign-in and sign-up screens, responsive and visual checks, Google sign-up UI                                              |
| `customer/`  | QR/slug review flow, public business profile, customer visuals and responsiveness                                         |
| `vendor/`    | Onboarding, dashboard, review location, subscription, invoice, mobile layout                                              |
| `admin/`     | Admin console: businesses, payments, team, MFA, activity log                                                              |
| `system/`    | The subscription cron endpoint `/api/cron/subscriptions` (`cron.spec.ts`, skipped unless `CRON_SECRET` is set)            |
| `support/`   | Shared helpers, not tests (below)                                                                                         |

Some older admin specs repeat their folder in the file name (`admin/admin-*.spec.ts`). Leave the
names alone: specs run one at a time in file-path order, a rename changes that order, and the admin
specs depend on it (see "Admin sign-in" below). The `customer-` prefix, by contrast, is functional;
see [desktop and mobile projects](#desktop-and-mobile-projects).

Helpers in `support/`:

- `db.ts`: direct PostgreSQL access to arrange state the UI cannot reach (reset the demo tenant's
  quota and entitlement, set up a paid year, clear reminders, restore owner details). It uses
  `DATABASE_URL` and falls back to the local dev database.
- `totp.ts`: an independent TOTP implementation, `signInAdmin()` (password plus MFA challenge) and
  the fixed TOTP secret the suite arms on the demo admin.
- `marketing-navigation.ts`: opens the collapsible marketing navigation on narrow screens.

## What it needs

The suite does not start anything itself. Before `pnpm e2e`:

1. **A database.** On Windows, `pnpm db:dev` in its own terminal (it keeps running). `pnpm db:dev`
   works on Windows only; on macOS and Linux start your own PostgreSQL 17 or newer (see
   [PostgreSQL by platform](../docs/operations/local-development.md#postgresql-by-platform)).
2. **Schema and demo data.** Apply the migrations and seed the demo tenant with the commands in
   [first-time setup](../docs/operations/local-development.md#first-time-setup) and
   [seeding the demo tenant](../docs/operations/local-development.md#seeding-the-demo-tenant).
3. **The app.** A running dev server, for example `pnpm --filter @ai-review/web dev` in another
   terminal (see [running the app](../docs/operations/local-development.md#running-the-app)).

AI agents ask the owner before migrating, seeding or running this suite against the owner's local
database; see
[approval before migrating, seeding or testing](../docs/operations/local-development.md#approval-before-migrating-seeding-or-testing).

**Re-seeding after a run.** `vendor/business-onboarding.spec.ts` signs up a new business on every
run and nothing deletes it, so afterwards the seed refuses because the database holds a business
other than the demo tenant. On a disposable local database, re-seed with the `--force` command in
[seeding the demo tenant](../docs/operations/local-development.md#seeding-the-demo-tenant). Never
use `--force` on a database whose data you want to keep; see
[a separate database for tests](../docs/operations/local-development.md#a-separate-database-for-tests).

The suite also needs:

- **Google Chrome installed.** Both projects use `channel: 'chrome'`, the locally installed
  Chrome, so no Playwright browser download is needed.
- **`.env`.** `playwright.config.ts` loads the root `.env` into the test process, so helpers see
  the same `DATABASE_URL`, `APP_BASE_URL` and `CRON_SECRET` as the dev server.
- **Admin sign-in.** Only `admin/admin.spec.ts` and `admin/admin-mfa.spec.ts` run
  `scripts/ops/create-admin.mjs` (in `beforeAll`) to give the seeded demo admin a known password
  and the suite's TOTP secret (`E2E_ADMIN_TOTP_SECRET` in `support/totp.ts`). The other admin
  specs only sign in. Because files run in path order, `admin/activity.spec.ts` and
  `admin/admin-business-tabs.spec.ts` run before those two; on a fresh database, run
  `pnpm e2e e2e/admin/admin.spec.ts` once first.
- **Rate limits.** The suite repeats real flows from one address and can trip the limiter. Set
  `RATE_LIMIT_MULTIPLIER` in the local `.env` to raise the allowances; the MFA spec reads the same
  value to know where the limit sits.

**Use a disposable local database.** The suite resets the demo tenant's quota and subscription,
creates and deletes test users, leaves signed-up test businesses behind, and overwrites the demo
admin's password and TOTP secret. Never point it at production.

## Running

| Command                                  | Runs                                    |
| ---------------------------------------- | --------------------------------------- |
| `pnpm e2e`                               | Everything, headless, both projects     |
| `pnpm e2e:headed`                        | Everything with a visible browser       |
| `pnpm e2e e2e/vendor`                    | One folder                              |
| `pnpm e2e e2e/marketing/pricing.spec.ts` | One file                                |
| `pnpm e2e e2e/customer --project=mobile` | One project only (`chrome` or `mobile`) |

`pnpm e2e` is `playwright test`, so any Playwright option can follow it.

Tests run one at a time (`workers: 1`, 60 s per test) against `E2E_BASE_URL`, default
`http://localhost:3000`.
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

Every variable the config and specs read. All are optional; the defaults suit a local run against
the seeded demo tenant.

| Variable                                                                 | Used for                                                                                                                 |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `E2E_BASE_URL`                                                           | The app's address (default `http://localhost:3000`; a few specs default to `127.0.0.1`)                                  |
| `E2E_SLUG`                                                               | Public business slug (default: the seeded demo, `demo-south-cafe`)                                                       |
| `E2E_OWNER_EMAIL`, `E2E_OWNER_PASSWORD`                                  | Vendor specs' sign-in (default: the seeded demo owner)                                                                   |
| `DATABASE_URL`                                                           | `support/db.ts` fixtures (falls back to the local dev database)                                                          |
| `APP_BASE_URL`                                                           | Compared with QR payloads, from the same `.env` as the dev server                                                        |
| `CRON_SECRET`                                                            | `system/cron.spec.ts`; the spec is skipped when it is unset                                                              |
| `RATE_LIMIT_MULTIPLIER`                                                  | Read by the MFA spec to know where the limit sits (see above)                                                            |
| `FAQ_SCREENSHOT_DIR`, `PRICING_SCREENSHOT_DIR`, `VENDOR_UI_ARTIFACT_DIR` | Folders for optional screenshots (pricing falls back to `VENDOR_UI_ARTIFACT_DIR/pricing`); nothing is written when unset |
| `PUBLIC_INFORMATION_SCREENSHOT_DIR`                                      | Screenshot folder for the public-information spec; the OS temp folder when unset                                         |
| `RESPONSIVE_QA_SCREENSHOT`                                               | File path for an optional admin-console screenshot in `admin/admin.spec.ts`                                              |
| `RESPONSIVE_DEBUG`                                                       | Prints the measured layout at each width in `marketing/landing-responsive.spec.ts`                                       |

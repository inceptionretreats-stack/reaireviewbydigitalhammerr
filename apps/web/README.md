# Web app (`@ai-review/web`)

This is the Ai Review web application: every screen and the whole backend in one Next.js project.
Read this first if you are about to change anything under `apps/web` — it explains what each folder
holds, how code is layered, how to run the app and where the common changes are made. Each of the
three main folders has its own README with more detail, and the map of the whole repository is in
[Architecture overview](../../docs/architecture/overview.md#repository-map).

> **Next.js version warning.** This app runs Next.js 16 (App Router) with React 19. As
> [`AGENTS.md`](AGENTS.md) says, this Next version differs from what most training data and older
> tutorials describe: APIs, conventions and file names have changed (for example, middleware is now
> [`proxy.ts`](proxy.ts)). Before changing framework-level code — routing, layouts, caching, the
> proxy, `next.config.ts` — read the relevant guide in `node_modules/next/dist/docs/` (resolved from
> this folder).

## What it is

- **UI and backend together.** Pages for four audiences (marketing visitors, customers who scan a
  QR, business owners, platform admins) plus the JSON API under `/api/v1/*` and the Vercel Cron
  handlers under `/api/cron/*`. There is no separate API server.
- **Deployed on Vercel** with the project's Root Directory set to `apps/web`. Region and cron
  schedules are in [`vercel.json`](vercel.json). Before deploying, follow the
  [deployment checklist](../../docs/operations/deployment-checklist.md); the first deployment's
  [Vercel runbook](../../docs/history/2026-09-17-vercel-deploy-runbook.md) is kept as a historical
  record only.
- **Domain logic lives in workspace packages** (`packages/*`, plus side-effect-free maintenance
  helpers from `apps/worker`). They ship as TypeScript source and Next compiles them through
  `transpilePackages` in [`next.config.ts`](next.config.ts), so the web app and the worker share one
  implementation.

## Names used in the code

Two words mean something narrower here than in everyday speech. The
[glossary](../../docs/glossary.md) has the full list.

- **"Dashboard" is the vendor workspace**, the signed-in area for business owners at `/app`. The
  same area is called `(vendor)` in `app/`, `vendor/` in `e2e/`, and `dashboard/` in `components/`.
  `lib/dashboard/` is narrower still: the `/app` overview loader and shared status, money and date
  formatting.
- **"Customer" is the anonymous person who scans the QR code** (`app/(customer)`,
  `components/customer/`, `lib/customer/`, `api/v1/public/`). A business's own contact list, the CRM
  at `/app/customers`, is `lib/crm/customers/`, `components/dashboard/customers/` and
  `api/v1/customers/`.

## Folder map

| Path                                  | What it is                                                                                                                                                                                                                                                                                |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`app/`](app/README.md)               | Routes: pages, layouts and route handlers, grouped by audience. Root layout, `globals.css` and `icon.svg` sit here too.                                                                                                                                                                   |
| [`lib/`](lib/README.md)               | Web-app logic shared by more than one route or component, by concern: guards, sessions, queries, request parsing, composition of `@ai-review/core` services, email, QR rendering.                                                                                                         |
| [`components/`](components/README.md) | React UI grouped by audience (`marketing`, `customer`, `auth`, `onboarding`, `dashboard` for the vendor workspace, `admin`) plus `shared`.                                                                                                                                                |
| [`proxy.ts`](proxy.ts)                | Next 16 replacement for `middleware.ts`; runs on every request. Serves the maintenance page when `MIGRATION_MAINTENANCE=1`, redirects sign-in pages from the legacy host, and mints the anonymous `dh_anon` cookie. Its tests are in `lib/infra/__tests__/migration-maintenance.test.ts`. |
| `assets/fonts/`                       | Fonts bundled at build time: DM Sans (site font, loaded in `app/layout.tsx`) and two Inter WOFF files (some marketing headings, and the source for the QR card font codegen), with their licences.                                                                                        |
| `public/`                             | Files served as-is from `/`: marketing videos, posters and FAQ screenshots under `public/marketing/`, third-party licence text under `public/licenses/`.                                                                                                                                  |
| [`next.config.ts`](next.config.ts)    | Loads the repository-root `.env`, lists `transpilePackages`, sets security headers and dev origins.                                                                                                                                                                                       |
| [`vercel.json`](vercel.json)          | Function region and the three Vercel Cron schedules (`/api/cron/subscriptions`, `/health`, `/maintenance`).                                                                                                                                                                               |
| `postcss.config.mjs`                  | Tailwind CSS 4 through its PostCSS plugin.                                                                                                                                                                                                                                                |
| `tsconfig.json`                       | Extends the root `tsconfig.base.json` and defines the `@/*` alias.                                                                                                                                                                                                                        |
| `next-env.d.ts`                       | Generated by Next. Do not edit or format it.                                                                                                                                                                                                                                              |
| [`AGENTS.md`](AGENTS.md), `CLAUDE.md` | Agent rules written (and re-added) by `next dev`. Keep both files committed; deleting them only makes the next `next dev` recreate them as an uncommitted change.                                                                                                                         |
| [`package.json`](package.json)        | Scripts `dev`, `build`, `start`, `typecheck`, and the dependency list.                                                                                                                                                                                                                    |

## How code is organised

A request goes through three layers:

1. **`app/` holds the routes.** A page composes components and loads the data its own screen needs;
   a route handler checks who is calling (`requireTenant`, `requireAdmin` or a public resolver),
   parses the request, does its work and shapes the response. Both may query the database directly
   with Drizzle when the query serves only that page or endpoint — about 16 pages and 22 handlers
   do (`git grep -l "from 'drizzle-orm'" -- apps/web/app` lists them). A helper used by only one
   route may sit beside it.
2. **`lib/` holds logic shared by more than one place**: guards, sessions, request parsing, queries
   and view models used by two routes, or by a page and a route, and the wiring that builds
   `@ai-review/core` services with this app's database and environment. That is the rule for new
   code: when a second place needs a query or helper that lives in a route, move it to `lib/`. A
   few older helpers are still copied between files; the
   [architecture overview](../../docs/architecture/overview.md#helpers-still-copied-between-files)
   lists them.
3. **`packages/*` hold domain logic shared with the worker**: `core` (Ai generation, prompts, quota,
   billing and Razorpay, auth primitives, tenancy, abuse, audit), `db` (Drizzle schema and
   migrations), `contracts` (Zod request and response schemas), `config` (environment schema),
   `analytics` (event taxonomy) and `ui` (shared React primitives and design tokens).

Reads and writes take different paths. Server Components — pages, and the few data-loading
components listed in [`components/README.md`](components/README.md#server-and-client-components) —
read on the server, never through `/api/v1`. Client components change data by calling the JSON API
under `/api/v1/*`.

Dependencies point one way: `app/` may import `lib/` and `components/`; `components/` may import
`lib/`; `lib/` imports neither. ESLint (`eslint.config.mjs`) fails the lint step when a file in
`lib/` imports `components/` or `app/`, or a file in `components/` imports `app/` (tests are exempt).
One more rule is kept by review only: client components (`'use client'`) may value-import only the
client-safe `lib/` modules listed in [`lib/README.md`](lib/README.md), and never `@ai-review/core`
or `@ai-review/db` at runtime — those pull `pg` and `argon2` into the browser bundle.

## Import conventions

| Import              | Use it for                                                                                                                                                             |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@/…`               | Anything in `apps/web` outside the current folder, e.g. `@/lib/infra/db`. Inside `lib/`, imports between concern folders always use `@/lib/<folder>/<module>`.         |
| `./…` and `../…`    | Siblings in the same folder, or the parent folder of the same audience area, e.g. `./ServicePicker`, `../link-styles` or `../site/MarketingSite`; tests import `../x`. |
| `@ai-review/<name>` | Workspace packages: `core`, `db`, `contracts`, `config`, `analytics`, `ui`, and `worker/maintenance`.                                                                  |

`@/*` maps to this folder in `tsconfig.json`; the root `vitest.config.mts` and
`vitest.integration.config.mts` define the same alias, so a test imports a module exactly as the app
does.

## Running it

Configuration comes from one `.env` at the repository root. `next.config.ts` loads it at start-up;
variables already set in the real environment win. There is no `apps/web/.env`.

| Command                                  | What it does                                                           |
| ---------------------------------------- | ---------------------------------------------------------------------- |
| `pnpm --filter @ai-review/web dev`       | Next dev server only (port 3000). You provide the database.            |
| `pnpm --filter @ai-review/web build`     | Production build.                                                      |
| `pnpm --filter @ai-review/web typecheck` | `tsc --noEmit` for this app.                                           |
| `pnpm dev:up`                            | Whole local stack from the root: database, tunnel and dev server.      |
| `pnpm dev`                               | From the root, starts the web app **and** the worker, which runs jobs. |

`pnpm dev:up` rewrites base URLs in the root `.env` and manages background processes. Read
[Local development](../../docs/operations/local-development.md) before using it, and for seeding and
the commands that change real data.

## Tests

| Kind        | Where                                                             | Run from the root       |
| ----------- | ----------------------------------------------------------------- | ----------------------- |
| Unit        | `__tests__/` beside the module it tests, files named `*.test.ts`  | `pnpm test`             |
| Integration | `__tests__/integration/` (real PostgreSQL through `DATABASE_URL`) | `pnpm test:integration` |
| Browser     | Root `e2e/` folder (Playwright)                                   | `pnpm e2e`              |

Unit tests run in Node with no DOM, and only `.ts` files are collected. Logic worth testing in a
component therefore lives in a sibling `.ts` module, for example
`components/onboarding/review-link.ts` beside `ReviewLinkStep.tsx`. A few test files in `lib/` are
not named after the module they test; [`lib/README.md`](lib/README.md#tests) lists them.

## Where do I change…

| Task                                 | Start here                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Landing page sections or their order | `components/marketing/home/HomeMarketingPage.tsx` (hero and section order); each section is its own file in `components/marketing/home/`. Header, nav and footer: `components/marketing/site/MarketingSite.tsx`; hero and header styles: `components/marketing/site/MarketingSite.module.css`. The hero sentence is owner-approved copy; read the [product decisions](../../docs/decisions/product-decisions.md) before rewording it.                                                                                                  |
| Pricing cards                        | `components/marketing/pricing/PricingPlanCards.tsx` (its "Show more" link is `PricingDetailsLink.tsx`); the `/legal/pricing` details page is `PricingPlanDetailsPage.tsx`. Price and draft allowances are not in code: change the live values at `/admin/settings`; the fallback defaults are `PLATFORM_SETTING_DEFAULTS` in `packages/core/src/platform/settings.ts`. Several browser tests assume the defaults (₹999). See [billing and plans](../../docs/features/billing-and-plans.md#changing-the-price-or-allowances).           |
| Customer review screen               | `components/customer/review/ReviewFlow.tsx` (with `ServicePicker.tsx`, `DraftEditor.tsx`), rendered by `app/(customer)/r/[code]/page.tsx` and `app/(customer)/[slug]/review/page.tsx`. The "not available" message for a disabled QR or an inactive business is written in `r/[code]/page.tsx` itself; `/[slug]/review` answers 404 instead.                                                                                                                                                                                           |
| Draft generation                     | `app/api/v1/public/review/generate/route.ts` → `lib/ai/generation-service.ts` → `packages/core`.                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| A vendor workspace screen            | `app/(vendor)/app/<screen>/page.tsx` and `components/dashboard/<screen>/`. Two exceptions: the `/app` home is `components/dashboard/overview/`, and `/app/review-modes` is `ReviewModesManager.tsx` and `ModeEditor.tsx` in `components/dashboard/ai-review/`. Sidebar links: `components/dashboard/shell/nav-items.ts`. Browser tests: `e2e/vendor/`.                                                                                                                                                                                 |
| An onboarding step                   | `components/onboarding/<Step>.tsx` and its page in `app/(vendor)/onboarding/`; step order is `lib/onboarding/steps.ts`.                                                                                                                                                                                                                                                                                                                                                                                                                |
| An admin screen                      | `app/(admin)/admin/<screen>/page.tsx`, the screen's folder in `components/admin/` (`businesses/`, `payments/`, `team/`, `activity/`, `ai/`, `settings/`) and its reads in `lib/admin/`. The `/admin` overview, the business list, the audit log, the prompt-version list and the team member page keep their markup in the page file. The business page's tabs are `components/admin/businesses/BusinessTabs.tsx`; most load their data through `lib/admin/business-tab-loaders.ts`. Admin nav: `components/admin/shell/AdminNav.tsx`. |
| An API endpoint                      | `app/api/v1/<area>/route.ts`; logic shared with other routes in the matching `lib/` folder; shared schemas in `packages/contracts`. Update the contract in `docs/openapi/v1.yaml`.                                                                                                                                                                                                                                                                                                                                                     |
| Email wording or layout              | `lib/email/email-templates.ts` holds every email; transport and sending are in `lib/email/mailer.ts`, which also re-exports `passwordResetEmail` for two callers.                                                                                                                                                                                                                                                                                                                                                                      |
| Printable QR card                    | `lib/qr/qr-card.ts` (PNG/SVG artwork), `lib/qr/qr-image.ts` (encoder settings), served by `app/api/v1/qr/[id]/download/route.ts`. The on-screen preview is `components/shared/qr/QrStandeePreview.tsx` — keep the two in step.                                                                                                                                                                                                                                                                                                         |
| Policy and contact pages             | `components/marketing/legal/PublicInformationPage.tsx`, pages in `app/(marketing)/legal/`, contact values in `lib/marketing/public-information.ts`.                                                                                                                                                                                                                                                                                                                                                                                    |

For the full list of URLs and which file serves each, see [`app/README.md`](app/README.md) and
[Routes](../../docs/architecture/routes.md).

# `app/` — routes

This folder is the Next.js App Router tree: every page, layout and route handler in the product.
Read it to find which file serves a URL, or to decide where a new route belongs. For the complete
URL-by-URL map, see [Routes](../../../docs/architecture/routes.md).

## Files at the root

| File          | Role                                                                                                                                                                   |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `layout.tsx`  | Root layout for every page: `<html>`, the DM Sans font from `../assets/fonts/`, default metadata (including `robots: noindex`).                                        |
| `globals.css` | Global styles. Imports `@ai-review/ui/styles.css` first (the Tailwind CSS 4 entry point and design tokens), then base styles, focus rings and the signed-in app shell. |
| `icon.svg`    | The favicon, picked up by Next's file convention.                                                                                                                      |

## Route groups

A folder in parentheses is a **route group**: it groups files and can carry its own layout, but its
name never appears in the URL. `app/(vendor)/app/qr/page.tsx` serves `/app/qr`, and
`app/(customer)/[slug]/page.tsx` serves `/{slug}`. (The `app` folder inside `(vendor)` is a real URL
segment, which is why vendor URLs start with `/app`.)

| Group         | URLs it serves                                                                                                                                                                                      | Audience and notes                                                                                                                                                                                       | UI in                                             |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `(marketing)` | `/`, `/legal/privacy`, `/legal/terms`, `/legal/cancellation-refunds`, `/legal/contact`, `/legal/pricing`                                                                                            | Public site. `/features`, `/how-it-works`, `/pricing`, `/legal/pricing/free` and `/legal/pricing/pro` are legacy stubs that permanently redirect.                                                        | `components/marketing/`                           |
| `(customer)`  | `/r/[code]` (QR scan), `/r/req/[token]`, `/[slug]` (public business page), `/[slug]/review`, `/[slug]/feedback`                                                                                     | Anonymous customers (the people who scan a QR). `/r/req/[token]` is a route handler: it records a tracked review-request link visit, then redirects to the business's review page.                       | `components/customer/`                            |
| `(auth)`      | `/login`, `/signup`, `/signup/google`, `/forgot-password`, `/reset-password`, `/login/mfa`, `/login/mfa/enrol`, `/invite`                                                                           | Account screens outside the workspace, in one shared layout. The last three are the admin MFA and invitation steps.                                                                                      | `components/auth/`                                |
| `(vendor)`    | `/app`, `/app/{ai-review, review-modes, qr, profile, customers, review-requests, feedback, analytics, subscription, settings}`, `/app/subscription/receipts/[id]`, `/onboarding` and its five steps | Business owners: the vendor workspace, called "dashboard" in `components/`. `(vendor)/app/layout.tsx` checks the session and draws the sidebar; `(vendor)/onboarding/layout.tsx` wraps the setup wizard. | `components/dashboard/`, `components/onboarding/` |
| `(admin)`     | `/admin`, `/admin/{businesses, ai, settings, payments, activity, audit, team}` and their `[id]` pages                                                                                               | Platform staff. The layout checks the session, the admin role and MFA; each API call is checked again on the server.                                                                                     | `components/admin/`                               |
| `api/v1/`     | `/api/v1/*`                                                                                                                                                                                         | The JSON API used by the client components. Not a route group: `api` is part of the URL.                                                                                                                 | —                                                 |
| `api/cron/`   | `/api/cron/subscriptions`, `/api/cron/health`, `/api/cron/maintenance`                                                                                                                              | Vercel Cron handlers, scheduled in `../vercel.json`. Each requires `Authorization: Bearer <CRON_SECRET>`.                                                                                                | —                                                 |

`[slug]` sits at the top level, so any new top-level page competes with business slugs. Static
segments win over `[slug]`, but a business that already owns a slug equal to a new folder name would
lose its public page. To stop a business claiming a platform path, add the segment to
`RESERVED_SLUGS` in `packages/core/src/business/slug.ts`. The list currently misses `invite`,
`forgot-password` and `reset-password` (see [known issues](../../../docs/known-issues.md)).

## The JSON API (`api/v1/`)

One folder per area. The maintained contract is [`docs/openapi/v1.yaml`](../../../docs/openapi/v1.yaml);
update it when you change an endpoint.

Two folder names are easy to mix up: `api/v1/public/` is the anonymous customer flow (its logic is
in `lib/customer/`), while `api/v1/customers/` is a business owner's CRM contact list (logic in
`lib/crm/customers/`).

| Area                                                                                                                | Who calls it   | Guard                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `public/` (review generation, events, private feedback)                                                             | Anonymous      | `resolvePublicRef` (`lib/customer/resolve-public-ref.ts`) and the anonymous session; rate limits on generation and feedback     |
| `auth/` (login, signup, Google, MFA, password reset, invite acceptance)                                             | Signed out     | CSRF origin check and rate limits; the MFA routes use `requirePendingAdmin` (`lib/auth/mfa-routes.ts`)                          |
| `business/`, `ai/`, `qr/`, `customers/`, `review-requests/`, `feedback/`, `analytics/`, `subscription/`, `account/` | Business owner | `requireTenant` (`lib/tenant/require-tenant.ts`), which also checks CSRF; `requireActiveTenant` where the business must be live |
| `admin/`                                                                                                            | Platform staff | `requireAdmin` (`lib/auth/require-admin.ts`): admin role, MFA, and a fresh MFA step-up for high-risk actions                    |
| `webhooks/razorpay/`                                                                                                | Razorpay       | Signature check on the raw body                                                                                                 |

Errors use one envelope, built by `apiError` in `lib/http/api-error.ts`. JSON bodies are read with
`readJsonObject` from `lib/http/request-body.ts`.

## Rules for route files

- **A route file does the work for its own URL.** A `route.ts` checks the caller, parses input, does
  its work and shapes the response; a `page.tsx` loads what its own screen shows. Both may build
  Drizzle queries inline when nothing else needs them: 16 pages and 22 handlers do today (list them
  with `git grep -l "from 'drizzle-orm'" -- apps/web/app`).
- **Pages read on the server**, never through `/api/v1`. Interactive client components write through
  `/api/v1/*`.
- **A helper used by only one route may sit beside it.** A Next route module may only export its HTTP
  methods and route config, so a testable piece goes in a sibling file. Today there are three, each
  imported by its own `route.ts` and its test and nothing else:
  `api/v1/qr/[id]/download/filename.ts`, `api/v1/ai/test-preview/preview-limit.ts` and
  `api/v1/business/review-destination/body.ts`.
- **Anything used by more than one place goes to `lib/`.** As soon as a second route, a page or a
  component needs a query or helper, move it to the matching `lib/` concern folder. For example, the
  date-range parsing shared by the three analytics endpoints is `lib/analytics/range-request.ts`.
  Business rules the worker also needs go in `packages/core`. This is the rule for new code; a few
  older helpers are still copied between route files, and the
  [architecture overview](../../../docs/architecture/overview.md#helpers-still-copied-between-files)
  lists them.
- **Tests** go in `__tests__/` beside the route, e.g. `api/v1/auth/signup/__tests__/route.test.ts`.

Before changing layouts, route segment config or the proxy, read the Next.js 16 guide in
`node_modules/next/dist/docs/` (see [`../AGENTS.md`](../AGENTS.md)).

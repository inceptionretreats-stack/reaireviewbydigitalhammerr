# `components/` — React UI

This folder holds the React components behind every page, grouped by who sees them. Read it to find
the component for a screen, to learn how styling works, or before adding a new component. Pages in
`app/` stay small and render these.

> **"Customer" means the person who scans the QR code.** `components/customer/`, `app/(customer)`
> and `lib/customer/` are the anonymous public flow. A business's own list of its customers (its
> CRM contact list at `/app/customers`) lives in `dashboard/customers/` and `lib/crm/customers/`.

## Folders

| Folder                       | What it is for                                                                                                                                                       | Rendered by                                                                       |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `marketing/site/`            | Shared marketing shell: header, section nav, footer with policy links, shared buttons and icons, and the main landing stylesheet.                                    | Every `(marketing)` page, through the components below                            |
| `marketing/home/`            | The landing page. `HomeMarketingPage.tsx` sets the hero and section order; each section (marquee, How it works videos, promo video, benefits, FAQ…) is its own file. | `/`                                                                               |
| `marketing/pricing/`         | Free and Pro plan cards (with their "Show more" link) and the shared plan details page.                                                                              | `/` (`#pricing`), `/legal/pricing`                                                |
| `marketing/legal/`           | `PublicInformationPage`, the shell for the policy and contact pages.                                                                                                 | `/legal/privacy`, `/legal/terms`, `/legal/cancellation-refunds`, `/legal/contact` |
| `marketing/parked/`          | `ReviewStoryVideo.tsx` — kept on purpose but **not mounted** (see below).                                                                                            | Nothing                                                                           |
| `customer/review/`           | The review flow: pick services, create an editable Ai draft, edit and confirm it, copy it and open Google (`ReviewFlow`, `ServicePicker`, `DraftEditor`).            | `/r/[code]`, `/[slug]/review`                                                     |
| `customer/feedback/`         | The private feedback form.                                                                                                                                           | `/[slug]/feedback`                                                                |
| `customer/profile/`          | The public business page with its contact and review buttons.                                                                                                        | `/[slug]`                                                                         |
| `auth/`                      | Login, signup, Google sign-in, forgot and reset password, admin MFA challenge and enrolment, invitation acceptance; `AuthShell.module.css`.                          | `(auth)` pages and layout                                                         |
| `onboarding/`                | The five setup steps and `WizardShell` (progress, headings, back/continue), with each step's logic in a sibling `.ts` module.                                        | `/onboarding/*`                                                                   |
| `dashboard/`                 | `link-styles.ts`: class strings for links that look like buttons, shared by the dashboard screens.                                                                   | —                                                                                 |
| `dashboard/shell/`           | Sidebar navigation (`DashboardNav`, `nav-items.ts`) and the workspace stylesheet `VendorWorkspace.module.css`.                                                       | `app/(vendor)/app/layout.tsx`                                                     |
| `dashboard/overview/`        | Dashboard home: setup progress, public page link, first steps, subscription and reporting cards.                                                                     | `/app`                                                                            |
| `dashboard/ai-review/`       | Ai context settings, active mode and prompt explanation; the review-modes manager and editor.                                                                        | `/app/ai-review`, `/app/review-modes`                                             |
| `dashboard/qr/`              | QR sources: list, create/rename, disable, downloads, help.                                                                                                           | `/app/qr`                                                                         |
| `dashboard/profile/`         | Public page editor: sections, order, preview, Google review location, appearance.                                                                                    | `/app/profile`                                                                    |
| `dashboard/customers/`       | The business's CRM contact list: table, add/edit and delete dialogs.                                                                                                 | `/app/customers`                                                                  |
| `dashboard/review-requests/` | Composer for manual review-request messages and the recent-requests list.                                                                                            | `/app/review-requests`                                                            |
| `dashboard/feedback/`        | Private feedback inbox: list, filters, detail drawer, empty states.                                                                                                  | `/app/feedback`                                                                   |
| `dashboard/analytics/`       | Analytics: KPI row, funnel, trend, QR source and link-click tables, date range filter.                                                                               | `/app/analytics`                                                                  |
| `dashboard/subscription/`    | Plan card with Razorpay checkout, and payment history.                                                                                                               | `/app/subscription`, `/app/subscription/receipts/[id]`                            |
| `dashboard/settings/`        | Account details, password change, billing details, sessions, business status.                                                                                        | `/app/settings`                                                                   |
| `admin/`                     | Admin nav and screens: payments, team, platform settings, prompt version editor, activity, plan badge, MFA step-up dialog.                                           | `(admin)` pages and layout                                                        |
| `admin/business-tabs/`       | The tabs of the admin business page, and the actions inside them.                                                                                                    | `/admin/businesses/[id]`                                                          |
| `shared/`                    | `AppBrand` (logo lockup) and `SignOutButton`.                                                                                                                        | Vendor and admin layouts; `AppBrand` also in the onboarding layout                |
| `shared/forms/`              | `use-form-submit.ts` (POST form hook) and `send-json.ts` (one JSON call); both unpack the API error envelope.                                                        | Auth, onboarding, dashboard and admin forms                                       |
| `shared/qr/`                 | `QrStandeePreview`, the on-screen twin of the printable QR card in `lib/qr/qr-card.ts`. Change both together.                                                        | Onboarding finish step, `/app`, `/app/qr`                                         |
| `shared/billing/`            | `InvoiceDocument` (printable invoice or receipt) and `PrintButton`.                                                                                                  | `/app/subscription/receipts/[id]`, `/admin/payments/[id]/invoice`                 |

## The parked video

`marketing/parked/ReviewStoryVideo.tsx` plays the shopkeeper story video
(`public/marketing/ai-review-customer-journey-v2-minimal-overlay.mp4`). It is deliberately not
mounted: the claims and dialogue in the video have not been verified, and the rights to the footage
are not established (see the [asset licence audit](../../../docs/compliance/asset-license-audit.md)).
Keep the component, and do not mount it without the owner's approval.

## Styling

Three layers, used together:

| Layer                        | Where                                                                                                                           | Used for                                                                                                                                                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Shared primitives and tokens | `packages/ui` (`@ai-review/ui`): `Button`, `Card`, `Field`, `Modal`, `Drawer`, `Table`…; tokens in `packages/ui/src/styles.css` | Dashboard and admin screens, styled with Tailwind CSS 4 utility classes. That stylesheet is also the Tailwind entry point.                                                                                                           |
| CSS Modules                  | `*.module.css` next to the component                                                                                            | Marketing, customer pages, auth, onboarding, the vendor workspace shell, the profile preview and the QR standee.                                                                                                                     |
| Global styles                | `app/globals.css`                                                                                                               | Imports the kit stylesheet and maps its tokens to short aliases; base and focus styles; the signed-in app shell (sidebar, top bar, kit overrides under `.app-shell` and `.onboarding-shell`); small layout helpers such as `.stack`. |

Write Tailwind class names out in full: Tailwind finds them by scanning source text, so a class name
built at runtime is never generated (`dashboard/link-styles.ts` explains this). The vendor workspace
look is recorded in [Vendor UI redesign](../../../docs/design/vendor-ui-redesign.md).

## Server and client components

A file that starts with `'use client'` is a client component, and so is everything it imports: for
example `ReviewFlowIcon.tsx` has no directive of its own but runs in the browser because
`ReviewFlow.tsx` imports it. Other components render on the server. Some server components load
their own data — for example `dashboard/overview/DashboardOverview.tsx` and
`dashboard/analytics/AnalyticsScreen.tsx` resolve the business and query through `lib/` inside a
Suspense boundary.

Client components must not import runtime values from `@ai-review/core`, `@ai-review/db` or any
server-only `lib/` module: that would pull `pg`, `ioredis` and `argon2` toward the browser bundle.
Type-only imports are fine. The client-safe `lib/` modules are listed in
[`lib/README.md`](../lib/README.md).

## Tests

Unit tests run in Node with no DOM and only collect `*.test.ts`, so component logic that deserves a
test goes in a sibling `.ts` module with its test in `__tests__/` next to it — for example
`onboarding/review-link.ts` and `onboarding/__tests__/review-link.test.ts`. Rendered behaviour is
covered by the Playwright suites in the root `e2e/` folder.

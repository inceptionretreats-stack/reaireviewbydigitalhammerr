# `components/` — React UI

This folder holds the React components behind every page, grouped by who sees them. Read it to find
the component for a screen, to learn how styling works, or before adding a new component. Most pages
in `app/` load their data and render these; a few admin pages keep their markup inline (listed
below the folder table).

> **Two folder names to read carefully.**
>
> - **`dashboard/` is the vendor (business-owner) workspace** served by `app/(vendor)/app/*` at
>   `/app` URLs; its browser tests are in `e2e/vendor/`. The name follows the spec's "Business
>   dashboard". The vendor setup wizard, also under `(vendor)`, is in `onboarding/`.
> - **"Customer" means the person who scans the QR code.** `customer/`, `app/(customer)` and
>   `lib/customer/` are the anonymous public flow. A business's own list of its customers (its CRM
>   contact list at `/app/customers`) lives in `dashboard/customers/` and `lib/crm/customers/`.
>
> The [glossary](../../../docs/glossary.md) lists the other overloaded words.

## Folders

| Folder                       | What it is for                                                                                                                                                                                                                                  | Rendered by                                                                       |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `marketing/site/`            | Shared marketing shell: header, section nav, footer with policy links, shared buttons and icons, and the main landing stylesheet. `MarketingSite.tsx` also exports `HeroVideoVisual`, which only the home page uses.                            | Every `(marketing)` page, through the components below                            |
| `marketing/home/`            | The landing page. `HomeMarketingPage.tsx` sets the hero and section order; each section (marquee, How it works videos, promo video, benefits, FAQ…) is its own file.                                                                            | `/`                                                                               |
| `marketing/pricing/`         | Free and Pro plan cards (`PricingPlanCards.tsx`), the "Show more" link on each card (`PricingDetailsLink.tsx`) and the plan details page (`PricingPlanDetailsPage.tsx`).                                                                        | `/` (`#pricing`), `/legal/pricing`                                                |
| `marketing/legal/`           | `PublicInformationPage`, the shell for the policy and contact pages.                                                                                                                                                                            | `/legal/privacy`, `/legal/terms`, `/legal/cancellation-refunds`, `/legal/contact` |
| `marketing/parked/`          | `ReviewStoryVideo.tsx` — kept on purpose but **not mounted** (see below).                                                                                                                                                                       | Nothing                                                                           |
| `customer/review/`           | The review flow: pick services, create an editable Ai draft, edit and confirm it, copy it and open Google (`ReviewFlow`, `ServicePicker`, `DraftEditor`).                                                                                       | `/r/[code]`, `/[slug]/review`                                                     |
| `customer/feedback/`         | The private feedback form.                                                                                                                                                                                                                      | `/[slug]/feedback`                                                                |
| `customer/profile/`          | The public business page with its contact and review buttons.                                                                                                                                                                                   | `/[slug]`                                                                         |
| `auth/`                      | Login, signup, Google sign-in, forgot and reset password, admin MFA challenge and enrolment, invitation acceptance. There is no `AuthShell` component: the shared shell markup is in `app/(auth)/layout.tsx`, styled by `AuthShell.module.css`. | `(auth)` pages and layout                                                         |
| `onboarding/`                | The five setup steps and `WizardShell` (progress, headings, back/continue), with each step's logic in a sibling `.ts` module.                                                                                                                   | `/onboarding/*`                                                                   |
| `dashboard/`                 | `link-styles.ts`: class strings for links that look like buttons, and the inline text-link style, shared by the vendor workspace screens.                                                                                                       | —                                                                                 |
| `dashboard/shell/`           | Sidebar navigation (`DashboardNav`, `nav-items.ts`) and the workspace stylesheet `VendorWorkspace.module.css`.                                                                                                                                  | `app/(vendor)/app/layout.tsx`                                                     |
| `dashboard/overview/`        | Workspace home: setup progress, public page link, first steps, subscription and reporting cards.                                                                                                                                                | `/app`                                                                            |
| `dashboard/ai-review/`       | Ai context settings, active mode and prompt explanation; also the review-modes manager and editor (`ReviewModesManager`, `ModeEditor`), which serve `/app/review-modes`.                                                                        | `/app/ai-review`, `/app/review-modes`                                             |
| `dashboard/qr/`              | QR sources: list, create/rename, disable, downloads, help. `qr-screen-model.ts` is the screen's data and rules.                                                                                                                                 | `/app/qr`                                                                         |
| `dashboard/profile/`         | Public page editor: sections, order, preview, Google review location, appearance.                                                                                                                                                               | `/app/profile`                                                                    |
| `dashboard/customers/`       | The business's CRM contact list: table, add/edit and delete dialogs.                                                                                                                                                                            | `/app/customers`                                                                  |
| `dashboard/review-requests/` | Composer for manual review-request messages and the recent-requests list.                                                                                                                                                                       | `/app/review-requests`                                                            |
| `dashboard/feedback/`        | Private feedback inbox: list, filters, detail drawer, empty states.                                                                                                                                                                             | `/app/feedback`                                                                   |
| `dashboard/analytics/`       | Analytics: KPI row, funnel, trend, QR source and link-click tables, date range filter.                                                                                                                                                          | `/app/analytics`                                                                  |
| `dashboard/subscription/`    | Plan card with Razorpay checkout, and payment history.                                                                                                                                                                                          | `/app/subscription`, `/app/subscription/receipts/[id]`                            |
| `dashboard/settings/`        | Account details, password change, billing details, sessions, business status.                                                                                                                                                                   | `/app/settings`                                                                   |
| `admin/`                     | Pieces shared by several admin screens: `PlanBadge` and `MfaStepUpDialog` (the fresh-MFA prompt used before high-risk actions).                                                                                                                 | Admin pages and the screens below                                                 |
| `admin/shell/`               | `AdminNav`, the admin console navigation.                                                                                                                                                                                                       | `app/(admin)/admin/layout.tsx`                                                    |
| `admin/businesses/`          | `BusinessTabs.tsx` (the eleven tabs of the business page), and the actions inside them: `BusinessActions`, `AbuseActions`, `SendPasswordResetButton`.                                                                                           | `/admin/businesses/[id]`                                                          |
| `admin/payments/`            | `PaymentsScreen` (payments, webhook ledger, reconcile, refund) and `PaymentFilters`.                                                                                                                                                            | `/admin/payments`                                                                 |
| `admin/team/`                | `TeamScreen`: invitations, roles, disabling admins, MFA resets.                                                                                                                                                                                 | `/admin/team`                                                                     |
| `admin/activity/`            | `ActivityFilters` and `ActivityTable`; the table is also used by the business page's Activity tab.                                                                                                                                              | `/admin/activity`, `/admin/businesses/[id]`                                       |
| `admin/ai/`                  | `PromptVersionEditor` for one prompt version.                                                                                                                                                                                                   | `/admin/ai/[id]`                                                                  |
| `admin/settings/`            | `PlatformSettingsForm`: draft allowances, Pro price, seller and invoice details.                                                                                                                                                                | `/admin/settings`                                                                 |
| `shared/`                    | `AppBrand` (logo lockup) and `SignOutButton`.                                                                                                                                                                                                   | Vendor and admin layouts; `AppBrand` also in the onboarding layout                |
| `shared/forms/`              | `use-form-submit.ts` (POST form hook) and `send-json.ts` (one JSON call); both unpack the API error envelope.                                                                                                                                   | Auth, onboarding, dashboard and admin forms                                       |
| `shared/qr/`                 | `QrStandeePreview`, the on-screen twin of the printable QR card in `lib/qr/qr-card.ts`. Change both together.                                                                                                                                   | Onboarding finish step, `/app`, `/app/qr`                                         |
| `shared/billing/`            | `InvoiceDocument` (printable invoice or receipt) and `PrintButton`.                                                                                                                                                                             | `/app/subscription/receipts/[id]`, `/admin/payments/[id]/invoice`                 |

Some admin pages have no component folder: the `/admin` overview, the business list, the audit log,
the prompt-version list and the team member page keep their markup in their `page.tsx`.

## The parked video

`marketing/parked/ReviewStoryVideo.tsx` plays the shopkeeper story video
(`public/marketing/ai-review-customer-journey-v2-minimal-overlay.mp4`). It is deliberately not
mounted: the claims and dialogue in the video have not been verified, and the rights to the footage
are not established (see the [asset licence audit](../../../docs/media-rights/asset-license-audit.md)).
Keep the component, and do not mount it without the owner's approval.

## Styling

Three layers, used together:

| Layer                        | Where                                                                                                                           | Used for                                                                                                                                                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Shared primitives and tokens | `packages/ui` (`@ai-review/ui`): `Button`, `Card`, `Field`, `Modal`, `Drawer`, `Table`…; tokens in `packages/ui/src/styles.css` | Dashboard and admin screens, styled with Tailwind CSS 4 utility classes. That stylesheet is also the Tailwind entry point.                                                                                                           |
| CSS Modules                  | `X.module.css` next to component `X`, or an area stylesheet named after the area it styles (listed below)                       | Marketing, customer pages, auth, onboarding, the vendor workspace shell, the profile preview and the QR standee.                                                                                                                     |
| Global styles                | `app/globals.css`                                                                                                               | Imports the kit stylesheet and maps its tokens to short aliases; base and focus styles; the signed-in app shell (sidebar, top bar, kit overrides under `.app-shell` and `.onboarding-shell`); small layout helpers such as `.stack`. |

Area stylesheets are named after an area rather than a component, and some of the markup they style
lives in `app/` layouts and pages:

| Stylesheet                                     | Imported by                                                                                                                                                                                         |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth/AuthShell.module.css`                    | `app/(auth)/layout.tsx` (the signed-out shell)                                                                                                                                                      |
| `dashboard/shell/VendorWorkspace.module.css`   | `app/(vendor)/app/layout.tsx`                                                                                                                                                                       |
| `onboarding/VendorOnboarding.module.css`       | `app/(vendor)/onboarding/layout.tsx` and `onboarding/WizardShell.tsx`                                                                                                                               |
| `customer/review/CustomerReview.module.css`    | `ReviewFlow`, `ServicePicker`, `DraftEditor`, `ReviewFlowIcon`, and the pages `app/(customer)/r/[code]` and `app/(customer)/[slug]/review`                                                          |
| `customer/feedback/PrivateFeedback.module.css` | `FeedbackForm` and the page `app/(customer)/[slug]/feedback`                                                                                                                                        |
| `marketing/site/MarketingSite.module.css`      | `MarketingSite.tsx` (which re-exports it as `marketingStyles` for `HomeMarketingPage` and `PricingPlanCards`), `MarketingSectionNav.tsx`, `home/HeroAiAccent.tsx` and `parked/ReviewStoryVideo.tsx` |

Write Tailwind class names out in full: Tailwind finds them by scanning source text, so a class name
built at runtime is never generated (`dashboard/link-styles.ts` explains this). The vendor workspace
look is recorded in [Vendor UI redesign](../../../docs/design/vendor-ui-redesign.md).

## Server and client components

A file that starts with `'use client'` is a client component, and so is everything it imports: for
example `ReviewFlowIcon.tsx` has no directive of its own but runs in the browser because
`ReviewFlow.tsx` imports it. Other components render on the server.

A few server components load their own data. This is the complete list:

- `dashboard/overview/DashboardOverview.tsx`, `dashboard/analytics/AnalyticsScreen.tsx`,
  `dashboard/review-requests/ReviewRequestsScreen.tsx` and
  `dashboard/feedback/FeedbackInboxSection.tsx`. Each resolves the session and the business itself
  and queries through `lib/`, so its page can show a Suspense loading state while it works.
- Nine of the eleven tab components in `admin/businesses/BusinessTabs.tsx`. They are async and load
  their own data: eight through `lib/admin/business-tab-loaders.ts`, using the database handle
  passed down from `app/(admin)/admin/businesses/[id]/page.tsx`, and the Activity tab through
  `lib/admin/activity.ts`. The other two, Billing and Audit, render from the business detail the
  page loads with `getBusinessDetail` (`lib/admin/businesses.ts`).

File-name suffixes such as `Screen`, `Section` or `Panel` do not tell you whether a component runs
on the server or the client — `AnalyticsScreen` is a server component, `CustomersScreen` a client
one. The first line of the file does.

Client components must not import runtime values from `@ai-review/core`, `@ai-review/db` or any
server-only `lib/` module: that would pull `pg`, `ioredis` and `argon2` toward the browser bundle.
Type-only imports are fine. The client-safe `lib/` modules are listed in
[`lib/README.md`](../lib/README.md). This rule is kept by review; no lint rule checks it.

What ESLint does check (`eslint.config.mjs`): no file in `components/` may import from `app/`
(tests are exempt). Code that both a page and a component need belongs in `lib/`.

## Tests

Unit tests run in Node with no DOM and only collect `*.test.ts`, so component logic that deserves a
test goes in a sibling `.ts` module with its test in `__tests__/` next to it — for example
`onboarding/review-link.ts` and `onboarding/__tests__/review-link.test.ts`. Rendered behaviour is
covered by the Playwright suites in the root `e2e/` folder.

# 24 September 2026 — repository restructure

This record explains the reorganisation of the repository on 24 September 2026 and maps every old
path to its new one. Use it when an older note, commit message, issue or AI conversation cites a
file that no longer exists at that path.

Nothing about the running product changed. The production build lists the same 130 routes before
and after, the Playwright suite lists the same 261 tests on the same projects, and the unit suite
passes (1,647 tests; three were removed together with the dead helpers they tested).

## What changed and why

| Area                  | Before                                                                                                       | After                                                                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/lib`        | 36 flat modules covering a dozen concerns                                                                    | One folder per concern (`infra`, `http`, `auth`, `tenant`, `customer`, `ai`, `qr`, `crm`, …) — see [`apps/web/lib/README.md`](../../apps/web/lib/README.md) |
| `apps/web/app/api`    | Domain services, schemas and repositories inside URL route folders, imported by pages and components         | Shared domain code in `lib/`; only route-local helpers stay beside their route                                                                              |
| `apps/web/components` | Customer-flow files loose at the top; server data code (queries, loaders, shared rules) inside `components/` | Folders by audience (`marketing`, `customer`, `auth`, `onboarding`, `dashboard`, `admin`, `shared`); server code moved to `lib/`                            |
| `apps/web/app`        | Marketing and customer routes loose at the root; vendor area at `app/(app)/app/…`                            | Route groups `(marketing)`, `(customer)`, `(auth)`, `(vendor)`, `(admin)`; URLs unchanged                                                                   |
| Tests                 | Vitest could not resolve `@/`, so tests used deep relative imports and passthrough mocks                     | `@/` resolves in Vitest exactly as in Next; imports climbing two or more folders use the alias                                                              |
| `scripts`             | 13 flat programs mixing dev helpers with tools that change real data                                         | `dev/`, `db/`, `ops/`, `media/`, `codegen/`, `supabase/` — see [`scripts/README.md`](../../scripts/README.md)                                               |
| `e2e`                 | 28 flat specs                                                                                                | `marketing/`, `auth/`, `customer/`, `vendor/`, `admin/`, `system/`, shared `support/`                                                                       |
| `docs`                | Seven flat UPPER_SNAKE files; the 80 KB `AI_HANDOVER.md` was the only orientation                            | Root `README.md`, `CONTRIBUTING.md`, and `docs/` by topic — see [`docs/README.md`](../README.md)                                                            |
| `.agents/`            | 62 vendored AI-assistant skill files committed                                                               | Untracked and ignored; still installed locally                                                                                                              |

## Removed as dead code

Each item was found by a reachability sweep and then checked by a second pass that tried to prove it
was still used. Git history keeps all of it.

- Components nothing rendered: `FeaturesMarketingPage`, the `PricingMarketingPage` wrapper,
  `ReviewerVisual`, `MarketingCallToAction`, and the `components/landing/LandingPage.tsx`
  pass-through.
- Unused exports: `renderQrPng`, `hashedIp`, the `DELETE /api/v1/auth/login` handler (in neither API
  document), test-only `canPublish`/`missingPublishRequirements`, `funnelStepLabel`,
  `isOwnerSettableStatus`, `tokensMatch`, `isSessionLive`, `AnalyticsEventInput`, `apiErrorResponse`,
  and the `exhaustFreeQuota` e2e helper.
- About 2,900 lines of CSS no markup referenced.
- 52 superseded media files (about 24 MB) in `apps/web/public/marketing`.
- Unused dependencies: `nanoid`, `zod`, `ioredis`, `@ai-review/analytics` and `@ai-review/config`
  in `packages/core`, and `@ai-review/config` at the root.

Kept on purpose: the parked `ReviewStoryVideo` and its media, API handlers listed in the frozen
contract, test doubles, and `isLadderStatus` (an exhaustiveness guard).

## Old → new paths

### Web app — `apps/web/lib`

| Old path                                               | New path                                                     |
| ------------------------------------------------------ | ------------------------------------------------------------ |
| `apps/web/lib/__tests__/auth-helpers.test.ts`          | `apps/web/lib/tenant/__tests__/tenant-shell.test.ts`         |
| `apps/web/lib/__tests__/backend-health.test.ts`        | `apps/web/lib/infra/__tests__/backend-health.test.ts`        |
| `apps/web/lib/__tests__/client-ip.test.ts`             | `apps/web/lib/http/__tests__/client-ip.test.ts`              |
| `apps/web/lib/__tests__/csrf-dev.test.ts`              | `apps/web/lib/http/__tests__/csrf-dev.test.ts`               |
| `apps/web/lib/__tests__/csrf.test.ts`                  | `apps/web/lib/http/__tests__/csrf.test.ts`                   |
| `apps/web/lib/__tests__/customer-services.test.ts`     | `apps/web/lib/customer/__tests__/customer-services.test.ts`  |
| `apps/web/lib/__tests__/draft-language.test.ts`        | `apps/web/lib/ai/__tests__/draft-language.test.ts`           |
| `apps/web/lib/__tests__/generation-service.test.ts`    | `apps/web/lib/ai/__tests__/generation-service.test.ts`       |
| `apps/web/lib/__tests__/google-auth.test.ts`           | `apps/web/lib/auth/__tests__/google-auth.test.ts`            |
| `apps/web/lib/__tests__/mailer.test.ts`                | `apps/web/lib/email/__tests__/mailer.test.ts`                |
| `apps/web/lib/__tests__/migration-maintenance.test.ts` | `apps/web/lib/infra/__tests__/migration-maintenance.test.ts` |
| `apps/web/lib/__tests__/next-path.test.ts`             | `apps/web/lib/auth/__tests__/next-path.test.ts`              |
| `apps/web/lib/__tests__/qr-card.test.ts`               | `apps/web/lib/qr/__tests__/qr-card.test.ts`                  |
| `apps/web/lib/__tests__/request-body.test.ts`          | `apps/web/lib/http/__tests__/request-body.test.ts`           |
| `apps/web/lib/__tests__/safe-error.test.ts`            | `apps/web/lib/infra/__tests__/safe-error.test.ts`            |
| `apps/web/lib/activity.ts`                             | `apps/web/lib/activity/recorder.ts`                          |
| `apps/web/lib/anonymous-session.ts`                    | `apps/web/lib/customer/anonymous-session.ts`                 |
| `apps/web/lib/api-error.ts`                            | `apps/web/lib/http/api-error.ts`                             |
| `apps/web/lib/auth-helpers.ts`                         | `apps/web/lib/auth/helpers.ts`                               |
| `apps/web/lib/backend-health.ts`                       | `apps/web/lib/infra/backend-health.ts`                       |
| `apps/web/lib/commercial-terms.ts`                     | `apps/web/lib/marketing/commercial-terms.ts`                 |
| `apps/web/lib/csrf.ts`                                 | `apps/web/lib/http/csrf.ts`                                  |
| `apps/web/lib/customer-services.ts`                    | `apps/web/lib/customer/customer-services.ts`                 |
| `apps/web/lib/db.ts`                                   | `apps/web/lib/infra/db.ts`                                   |
| `apps/web/lib/draft-language.ts`                       | `apps/web/lib/ai/draft-language.ts`                          |
| `apps/web/lib/email-templates.ts`                      | `apps/web/lib/email/email-templates.ts`                      |
| `apps/web/lib/env.ts`                                  | `apps/web/lib/infra/env.ts`                                  |
| `apps/web/lib/generation-service.ts`                   | `apps/web/lib/ai/generation-service.ts`                      |
| `apps/web/lib/google-auth-session.ts`                  | `apps/web/lib/auth/google-auth-session.ts`                   |
| `apps/web/lib/google-auth.ts`                          | `apps/web/lib/auth/google-auth.ts`                           |
| `apps/web/lib/landing-demo.ts`                         | `apps/web/lib/marketing/landing-demo.ts`                     |
| `apps/web/lib/mailer.ts`                               | `apps/web/lib/email/mailer.ts`                               |
| `apps/web/lib/mfa-routes.ts`                           | `apps/web/lib/auth/mfa-routes.ts`                            |
| `apps/web/lib/mfa.ts`                                  | `apps/web/lib/auth/mfa.ts`                                   |
| `apps/web/lib/migration-maintenance.ts`                | `apps/web/lib/infra/migration-maintenance.ts`                |
| `apps/web/lib/onboarding-progress.ts`                  | `apps/web/lib/onboarding/progress.ts`                        |
| `apps/web/lib/public-business.ts`                      | `apps/web/lib/customer/public-business.ts`                   |
| `apps/web/lib/public-information.ts`                   | `apps/web/lib/marketing/public-information.ts`               |
| `apps/web/lib/qr-card-fonts.generated.ts`              | `apps/web/lib/qr/qr-card-fonts.generated.ts`                 |
| `apps/web/lib/qr-card-text.ts`                         | `apps/web/lib/qr/qr-card-text.ts`                            |
| `apps/web/lib/qr-card.ts`                              | `apps/web/lib/qr/qr-card.ts`                                 |
| `apps/web/lib/qr-image.ts`                             | `apps/web/lib/qr/qr-image.ts`                                |
| `apps/web/lib/rate-limit.ts`                           | `apps/web/lib/http/rate-limit.ts`                            |
| `apps/web/lib/request-body.ts`                         | `apps/web/lib/http/request-body.ts`                          |
| `apps/web/lib/require-admin.ts`                        | `apps/web/lib/auth/require-admin.ts`                         |
| `apps/web/lib/require-tenant.ts`                       | `apps/web/lib/tenant/require-tenant.ts`                      |
| `apps/web/lib/resolve-public-ref.ts`                   | `apps/web/lib/customer/resolve-public-ref.ts`                |
| `apps/web/lib/safe-error.ts`                           | `apps/web/lib/infra/safe-error.ts`                           |
| `apps/web/lib/session.ts`                              | `apps/web/lib/auth/session.ts`                               |
| `apps/web/lib/subscription.ts`                         | `apps/web/lib/billing/subscription.ts`                       |
| `apps/web/lib/tenant-shell.ts`                         | `apps/web/lib/tenant/tenant-shell.ts`                        |

### Web app — domain code moved out of `apps/web/app/api`

| Old path                                                                 | New path                                                              |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| `apps/web/app/api/v1/account/__tests__/schema.test.ts`                   | `apps/web/lib/account/__tests__/schema.test.ts`                       |
| `apps/web/app/api/v1/account/__tests__/session-count.test.ts`            | `apps/web/lib/account/__tests__/session-count.test.ts`                |
| `apps/web/app/api/v1/account/schema.ts`                                  | `apps/web/lib/account/schema.ts`                                      |
| `apps/web/app/api/v1/account/session-count.ts`                           | `apps/web/lib/account/session-count.ts`                               |
| `apps/web/app/api/v1/ai/modes/__tests__/mode-service.test.ts`            | `apps/web/lib/ai/modes/__tests__/mode-service.test.ts`                |
| `apps/web/app/api/v1/ai/modes/__tests__/schema.test.ts`                  | `apps/web/lib/ai/modes/__tests__/schema.test.ts`                      |
| `apps/web/app/api/v1/ai/modes/guards.ts`                                 | `apps/web/lib/ai/modes/guards.ts`                                     |
| `apps/web/app/api/v1/ai/modes/mode-service.ts`                           | `apps/web/lib/ai/modes/mode-service.ts`                               |
| `apps/web/app/api/v1/ai/modes/schema.ts`                                 | `apps/web/lib/ai/modes/schema.ts`                                     |
| `apps/web/app/api/v1/customers/__tests__/body.test.ts`                   | `apps/web/lib/crm/customers/__tests__/body.test.ts`                   |
| `apps/web/app/api/v1/customers/__tests__/customer-status.test.ts`        | `apps/web/lib/crm/customers/__tests__/customer-status.test.ts`        |
| `apps/web/app/api/v1/customers/__tests__/query.test.ts`                  | `apps/web/lib/crm/customers/__tests__/query.test.ts`                  |
| `apps/web/app/api/v1/customers/body.ts`                                  | `apps/web/lib/crm/customers/body.ts`                                  |
| `apps/web/app/api/v1/customers/customer-status.ts`                       | `apps/web/lib/crm/customers/customer-status.ts`                       |
| `apps/web/app/api/v1/customers/query.ts`                                 | `apps/web/lib/crm/customers/query.ts`                                 |
| `apps/web/app/api/v1/customers/repository.ts`                            | `apps/web/lib/crm/customers/repository.ts`                            |
| `apps/web/app/api/v1/qr/__tests__/qr-source.test.ts`                     | `apps/web/lib/qr/__tests__/qr-source.test.ts`                         |
| `apps/web/app/api/v1/qr/qr-source.ts`                                    | `apps/web/lib/qr/qr-source.ts`                                        |
| `apps/web/app/api/v1/review-requests/__tests__/customer-journey.test.ts` | `apps/web/lib/crm/review-requests/__tests__/customer-journey.test.ts` |
| `apps/web/app/api/v1/review-requests/__tests__/link-preview.test.ts`     | `apps/web/lib/crm/review-requests/__tests__/link-preview.test.ts`     |
| `apps/web/app/api/v1/review-requests/__tests__/service-scope.test.ts`    | `apps/web/lib/crm/review-requests/__tests__/service-scope.test.ts`    |
| `apps/web/app/api/v1/review-requests/__tests__/template.test.ts`         | `apps/web/lib/crm/review-requests/__tests__/template.test.ts`         |
| `apps/web/app/api/v1/review-requests/compose-request.ts`                 | `apps/web/lib/crm/review-requests/compose-request.ts`                 |
| `apps/web/app/api/v1/review-requests/customer-journey.ts`                | `apps/web/lib/crm/review-requests/customer-journey.ts`                |
| `apps/web/app/api/v1/review-requests/link-preview.ts`                    | `apps/web/lib/crm/review-requests/link-preview.ts`                    |
| `apps/web/app/api/v1/review-requests/service.ts`                         | `apps/web/lib/crm/review-requests/service.ts`                         |
| `apps/web/app/api/v1/review-requests/template.ts`                        | `apps/web/lib/crm/review-requests/template.ts`                        |

### Web app — `apps/web/components`

| Old path                                                            | New path                                                                  |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `apps/web/components/CustomerReview.module.css`                     | `apps/web/components/customer/review/CustomerReview.module.css`           |
| `apps/web/components/DraftEditor.tsx`                               | `apps/web/components/customer/review/DraftEditor.tsx`                     |
| `apps/web/components/FeedbackForm.tsx`                              | `apps/web/components/customer/feedback/FeedbackForm.tsx`                  |
| `apps/web/components/PrivateFeedback.module.css`                    | `apps/web/components/customer/feedback/PrivateFeedback.module.css`        |
| `apps/web/components/PublicProfile.module.css`                      | `apps/web/components/customer/profile/PublicProfile.module.css`           |
| `apps/web/components/PublicProfile.tsx`                             | `apps/web/components/customer/profile/PublicProfile.tsx`                  |
| `apps/web/components/ReviewFlow.tsx`                                | `apps/web/components/customer/review/ReviewFlow.tsx`                      |
| `apps/web/components/ReviewFlowIcon.tsx`                            | `apps/web/components/customer/review/ReviewFlowIcon.tsx`                  |
| `apps/web/components/ServicePicker.tsx`                             | `apps/web/components/customer/review/ServicePicker.tsx`                   |
| `apps/web/components/auth/use-form-submit.ts`                       | `apps/web/components/shared/forms/use-form-submit.ts`                     |
| `apps/web/components/billing/InvoiceDocument.tsx`                   | `apps/web/components/shared/billing/InvoiceDocument.tsx`                  |
| `apps/web/components/brand/AppBrand.tsx`                            | `apps/web/components/shared/AppBrand.tsx`                                 |
| `apps/web/components/dashboard/CopyLinkButton.tsx`                  | `apps/web/components/dashboard/overview/CopyLinkButton.tsx`               |
| `apps/web/components/dashboard/DashboardNav.tsx`                    | `apps/web/components/dashboard/shell/DashboardNav.tsx`                    |
| `apps/web/components/dashboard/DashboardOverview.tsx`               | `apps/web/components/dashboard/overview/DashboardOverview.tsx`            |
| `apps/web/components/dashboard/DashboardSkeleton.tsx`               | `apps/web/components/dashboard/overview/DashboardSkeleton.tsx`            |
| `apps/web/components/dashboard/FirstStepsCard.tsx`                  | `apps/web/components/dashboard/overview/FirstStepsCard.tsx`               |
| `apps/web/components/dashboard/LiveFigures.tsx`                     | `apps/web/components/dashboard/overview/LiveFigures.tsx`                  |
| `apps/web/components/dashboard/PublicPageCard.tsx`                  | `apps/web/components/dashboard/overview/PublicPageCard.tsx`               |
| `apps/web/components/dashboard/ReportingCard.tsx`                   | `apps/web/components/dashboard/overview/ReportingCard.tsx`                |
| `apps/web/components/dashboard/SetupProgressCard.tsx`               | `apps/web/components/dashboard/overview/SetupProgressCard.tsx`            |
| `apps/web/components/dashboard/SignOutButton.tsx`                   | `apps/web/components/shared/SignOutButton.tsx`                            |
| `apps/web/components/dashboard/SubscriptionCard.tsx`                | `apps/web/components/dashboard/overview/SubscriptionCard.tsx`             |
| `apps/web/components/dashboard/VendorWorkspace.module.css`          | `apps/web/components/dashboard/shell/VendorWorkspace.module.css`          |
| `apps/web/components/dashboard/__tests__/nav-items.test.ts`         | `apps/web/components/dashboard/shell/__tests__/nav-items.test.ts`         |
| `apps/web/components/dashboard/__tests__/setup-progress.test.ts`    | `apps/web/components/dashboard/overview/__tests__/setup-progress.test.ts` |
| `apps/web/components/dashboard/ai`                                  | `apps/web/components/dashboard/ai-review`                                 |
| `apps/web/components/dashboard/ai/send-json.ts`                     | `apps/web/components/shared/forms/send-json.ts`                           |
| `apps/web/components/dashboard/nav-items.ts`                        | `apps/web/components/dashboard/shell/nav-items.ts`                        |
| `apps/web/components/dashboard/requests`                            | `apps/web/components/dashboard/review-requests`                           |
| `apps/web/components/dashboard/setup-progress.ts`                   | `apps/web/components/dashboard/overview/setup-progress.ts`                |
| `apps/web/components/dashboard/subscription/PrintButton.tsx`        | `apps/web/components/shared/billing/PrintButton.tsx`                      |
| `apps/web/components/marketing/BusinessAudienceIcons.tsx`           | `apps/web/components/marketing/home/BusinessAudienceIcons.tsx`            |
| `apps/web/components/marketing/BusinessAudienceStrip.module.css`    | `apps/web/components/marketing/home/BusinessAudienceStrip.module.css`     |
| `apps/web/components/marketing/BusinessAudienceStrip.tsx`           | `apps/web/components/marketing/home/BusinessAudienceStrip.tsx`            |
| `apps/web/components/marketing/FaqSection.module.css`               | `apps/web/components/marketing/home/FaqSection.module.css`                |
| `apps/web/components/marketing/FaqSection.tsx`                      | `apps/web/components/marketing/home/FaqSection.tsx`                       |
| `apps/web/components/marketing/HeroAiAccent.tsx`                    | `apps/web/components/marketing/home/HeroAiAccent.tsx`                     |
| `apps/web/components/marketing/HeroReviewVideo.module.css`          | `apps/web/components/marketing/home/HeroReviewVideo.module.css`           |
| `apps/web/components/marketing/HeroReviewVideo.tsx`                 | `apps/web/components/marketing/home/HeroReviewVideo.tsx`                  |
| `apps/web/components/marketing/HomeMarketingPage.tsx`               | `apps/web/components/marketing/home/HomeMarketingPage.tsx`                |
| `apps/web/components/marketing/HowItWorksClip.module.css`           | `apps/web/components/marketing/home/HowItWorksClip.module.css`            |
| `apps/web/components/marketing/HowItWorksClip.tsx`                  | `apps/web/components/marketing/home/HowItWorksClip.tsx`                   |
| `apps/web/components/marketing/HowItWorksVideos.module.css`         | `apps/web/components/marketing/home/HowItWorksVideos.module.css`          |
| `apps/web/components/marketing/HowItWorksVideos.tsx`                | `apps/web/components/marketing/home/HowItWorksVideos.tsx`                 |
| `apps/web/components/marketing/MarketingSectionNav.tsx`             | `apps/web/components/marketing/site/MarketingSectionNav.tsx`              |
| `apps/web/components/marketing/MarketingSite.module.css`            | `apps/web/components/marketing/site/MarketingSite.module.css`             |
| `apps/web/components/marketing/MarketingSite.tsx`                   | `apps/web/components/marketing/site/MarketingSite.tsx`                    |
| `apps/web/components/marketing/PricingDetails.module.css`           | `apps/web/components/marketing/pricing/PricingDetails.module.css`         |
| `apps/web/components/marketing/PricingDetails.tsx`                  | `apps/web/components/marketing/pricing/PricingDetails.tsx`                |
| `apps/web/components/marketing/PricingMarketingPage.tsx`            | `apps/web/components/marketing/pricing/PricingPlanCards.tsx`              |
| `apps/web/components/marketing/PricingPlanDetailsPage.module.css`   | `apps/web/components/marketing/pricing/PricingPlanDetailsPage.module.css` |
| `apps/web/components/marketing/PricingPlanDetailsPage.tsx`          | `apps/web/components/marketing/pricing/PricingPlanDetailsPage.tsx`        |
| `apps/web/components/marketing/PromoVideoSection.module.css`        | `apps/web/components/marketing/home/PromoVideoSection.module.css`         |
| `apps/web/components/marketing/PromoVideoSection.tsx`               | `apps/web/components/marketing/home/PromoVideoSection.tsx`                |
| `apps/web/components/marketing/PublicInformationPage.module.css`    | `apps/web/components/marketing/legal/PublicInformationPage.module.css`    |
| `apps/web/components/marketing/PublicInformationPage.tsx`           | `apps/web/components/marketing/legal/PublicInformationPage.tsx`           |
| `apps/web/components/marketing/ReviewBenefits.module.css`           | `apps/web/components/marketing/home/ReviewBenefits.module.css`            |
| `apps/web/components/marketing/ReviewBenefits.tsx`                  | `apps/web/components/marketing/home/ReviewBenefits.tsx`                   |
| `apps/web/components/marketing/ReviewBenefitsDraft.tsx`             | `apps/web/components/marketing/home/ReviewBenefitsDraft.tsx`              |
| `apps/web/components/marketing/ReviewOpportunitySection.module.css` | `apps/web/components/marketing/home/ReviewOpportunitySection.module.css`  |
| `apps/web/components/marketing/ReviewOpportunitySection.tsx`        | `apps/web/components/marketing/home/ReviewOpportunitySection.tsx`         |
| `apps/web/components/marketing/ReviewStoryVideo.tsx`                | `apps/web/components/marketing/parked/ReviewStoryVideo.tsx`               |
| `apps/web/components/marketing/RobotClaimBand.module.css`           | `apps/web/components/marketing/home/RobotClaimBand.module.css`            |
| `apps/web/components/marketing/RobotClaimBand.tsx`                  | `apps/web/components/marketing/home/RobotClaimBand.tsx`                   |
| `apps/web/components/qr/QrStandeePreview.module.css`                | `apps/web/components/shared/qr/QrStandeePreview.module.css`               |
| `apps/web/components/qr/QrStandeePreview.tsx`                       | `apps/web/components/shared/qr/QrStandeePreview.tsx`                      |

### Web app — server code moved from `components/` to `lib/`

| Old path                                                            | New path                                                |
| ------------------------------------------------------------------- | ------------------------------------------------------- |
| `apps/web/components/dashboard/__tests__/presentation.test.ts`      | `apps/web/lib/dashboard/__tests__/presentation.test.ts` |
| `apps/web/components/dashboard/analytics/__tests__/metrics.test.ts` | `apps/web/lib/analytics/__tests__/metrics.test.ts`      |
| `apps/web/components/dashboard/analytics/__tests__/queries.test.ts` | `apps/web/lib/analytics/__tests__/queries.test.ts`      |
| `apps/web/components/dashboard/analytics/__tests__/range.test.ts`   | `apps/web/lib/analytics/__tests__/range.test.ts`        |
| `apps/web/components/dashboard/analytics/metrics.ts`                | `apps/web/lib/analytics/metrics.ts`                     |
| `apps/web/components/dashboard/analytics/queries.ts`                | `apps/web/lib/analytics/queries.ts`                     |
| `apps/web/components/dashboard/analytics/range.ts`                  | `apps/web/lib/analytics/range.ts`                       |
| `apps/web/components/dashboard/feedback/__tests__/filters.test.ts`  | `apps/web/lib/feedback/__tests__/filters.test.ts`       |
| `apps/web/components/dashboard/feedback/__tests__/row.test.ts`      | `apps/web/lib/feedback/__tests__/row.test.ts`           |
| `apps/web/components/dashboard/feedback/filters.ts`                 | `apps/web/lib/feedback/filters.ts`                      |
| `apps/web/components/dashboard/feedback/inbox.ts`                   | `apps/web/lib/feedback/inbox.ts`                        |
| `apps/web/components/dashboard/feedback/row.ts`                     | `apps/web/lib/feedback/row.ts`                          |
| `apps/web/components/dashboard/presentation.ts`                     | `apps/web/lib/dashboard/presentation.ts`                |
| `apps/web/components/dashboard/profile/__tests__/order.test.ts`     | `apps/web/lib/profile/__tests__/order.test.ts`          |
| `apps/web/components/dashboard/profile/__tests__/sections.test.ts`  | `apps/web/lib/profile/__tests__/sections.test.ts`       |
| `apps/web/components/dashboard/profile/order.ts`                    | `apps/web/lib/profile/order.ts`                         |
| `apps/web/components/dashboard/profile/sections.ts`                 | `apps/web/lib/profile/sections.ts`                      |
| `apps/web/components/dashboard/settings/account.ts`                 | `apps/web/lib/account/settings.ts`                      |
| `apps/web/components/dashboard/summary.ts`                          | `apps/web/lib/dashboard/summary.ts`                     |
| `apps/web/components/onboarding/__tests__/steps.test.ts`            | `apps/web/lib/onboarding/__tests__/steps.test.ts`       |
| `apps/web/components/onboarding/steps.ts`                           | `apps/web/lib/onboarding/steps.ts`                      |

### Web app — route groups (URLs unchanged)

| Old path                    | New path                                |
| --------------------------- | --------------------------------------- |
| `apps/web/app/(app)`        | `apps/web/app/(vendor)`                 |
| `apps/web/app/[slug]`       | `apps/web/app/(customer)/[slug]`        |
| `apps/web/app/features`     | `apps/web/app/(marketing)/features`     |
| `apps/web/app/how-it-works` | `apps/web/app/(marketing)/how-it-works` |
| `apps/web/app/legal`        | `apps/web/app/(marketing)/legal`        |
| `apps/web/app/page.tsx`     | `apps/web/app/(marketing)/page.tsx`     |
| `apps/web/app/pricing`      | `apps/web/app/(marketing)/pricing`      |
| `apps/web/app/r`            | `apps/web/app/(customer)/r`             |

### Scripts

| Old path                                 | New path                                     |
| ---------------------------------------- | -------------------------------------------- |
| `scripts/__tests__/seed.test.ts`         | `scripts/db/__tests__/seed.test.ts`          |
| `scripts/check-migrations.mjs`           | `scripts/db/check-migrations.mjs`            |
| `scripts/create-admin.mjs`               | `scripts/ops/create-admin.mjs`               |
| `scripts/db-reencode.mjs`                | `scripts/db/db-reencode.mjs`                 |
| `scripts/dev-db.mjs`                     | `scripts/dev/dev-db.mjs`                     |
| `scripts/dev-down.mjs`                   | `scripts/dev/dev-down.mjs`                   |
| `scripts/dev-up.mjs`                     | `scripts/dev/dev-up.mjs`                     |
| `scripts/generate-qr-card-fonts.mjs`     | `scripts/codegen/generate-qr-card-fonts.mjs` |
| `scripts/mark-payment-failed.mjs`        | `scripts/ops/mark-payment-failed.mjs`        |
| `scripts/media/robot-artwork-prompts.md` | `docs/media-rights/robot-artwork-prompts.md` |
| `scripts/prompt-versions`                | `scripts/db/prompt-versions`                 |
| `scripts/reconcile-payment.mjs`          | `scripts/ops/reconcile-payment.mjs`          |
| `scripts/render-hero-walkthrough.mjs`    | `scripts/media/render-hero-walkthrough.mjs`  |
| `scripts/render-how-it-works.mjs`        | `scripts/media/render-how-it-works.mjs`      |
| `scripts/seed.ts`                        | `scripts/db/seed.ts`                         |
| `scripts/set-ai-model.mjs`               | `scripts/ops/set-ai-model.mjs`               |
| `scripts/tunnel.mjs`                     | `scripts/dev/tunnel.mjs`                     |

### End-to-end tests

| Old path                                 | New path                                          |
| ---------------------------------------- | ------------------------------------------------- |
| `e2e/activity.spec.ts`                   | `e2e/admin/activity.spec.ts`                      |
| `e2e/admin-business-tabs.spec.ts`        | `e2e/admin/admin-business-tabs.spec.ts`           |
| `e2e/admin-mfa.spec.ts`                  | `e2e/admin/admin-mfa.spec.ts`                     |
| `e2e/admin-payments.spec.ts`             | `e2e/admin/admin-payments.spec.ts`                |
| `e2e/admin-team.spec.ts`                 | `e2e/admin/admin-team.spec.ts`                    |
| `e2e/admin.spec.ts`                      | `e2e/admin/admin.spec.ts`                         |
| `e2e/auth-responsive.spec.ts`            | `e2e/auth/auth-responsive.spec.ts`                |
| `e2e/auth-visual.spec.ts`                | `e2e/auth/auth-visual.spec.ts`                    |
| `e2e/business-onboarding.spec.ts`        | `e2e/vendor/business-onboarding.spec.ts`          |
| `e2e/cron.spec.ts`                       | `e2e/system/cron.spec.ts`                         |
| `e2e/customer-public-responsive.spec.ts` | `e2e/customer/customer-public-responsive.spec.ts` |
| `e2e/customer-review-flow.spec.ts`       | `e2e/customer/customer-review-flow.spec.ts`       |
| `e2e/customer-review-visual.spec.ts`     | `e2e/customer/customer-review-visual.spec.ts`     |
| `e2e/dashboard.spec.ts`                  | `e2e/vendor/dashboard.spec.ts`                    |
| `e2e/faq.spec.ts`                        | `e2e/marketing/faq.spec.ts`                       |
| `e2e/google-signup-ui.spec.ts`           | `e2e/auth/google-signup-ui.spec.ts`               |
| `e2e/helpers/marketing-navigation.ts`    | `e2e/support/marketing-navigation.ts`             |
| `e2e/invoice.spec.ts`                    | `e2e/vendor/invoice.spec.ts`                      |
| `e2e/landing-mobile.spec.ts`             | `e2e/marketing/landing-mobile.spec.ts`            |
| `e2e/landing-responsive.spec.ts`         | `e2e/marketing/landing-responsive.spec.ts`        |
| `e2e/landing.spec.ts`                    | `e2e/marketing/landing.spec.ts`                   |
| `e2e/pricing.spec.ts`                    | `e2e/marketing/pricing.spec.ts`                   |
| `e2e/promo-video.spec.ts`                | `e2e/marketing/promo-video.spec.ts`               |
| `e2e/public-information.spec.ts`         | `e2e/marketing/public-information.spec.ts`        |
| `e2e/public-profile.spec.ts`             | `e2e/customer/public-profile.spec.ts`             |
| `e2e/review-location.spec.ts`            | `e2e/vendor/review-location.spec.ts`              |
| `e2e/review-opportunity.spec.ts`         | `e2e/marketing/review-opportunity.spec.ts`        |
| `e2e/subscription.spec.ts`               | `e2e/vendor/subscription.spec.ts`                 |
| `e2e/vendor-mobile-responsive.spec.ts`   | `e2e/vendor/vendor-mobile-responsive.spec.ts`     |

### Media source art (no longer deployed)

| Old path                                                   | New path                                              |
| ---------------------------------------------------------- | ----------------------------------------------------- |
| `apps/web/public/marketing/customer-reviewing-auth.png`    | `scripts/media/assets/customer-reviewing-auth.png`    |
| `apps/web/public/marketing/digital-hammerr-agency-v1.png`  | `scripts/media/assets/digital-hammerr-agency-v1.png`  |
| `apps/web/public/marketing/hero-review-scene-v1.png`       | `scripts/media/assets/hero-review-scene-v1.png`       |
| `apps/web/public/marketing/hero-review-scene-v2.png`       | `scripts/media/assets/hero-review-scene-v2.png`       |
| `apps/web/public/marketing/hero-review-walkthrough-v2.vtt` | `scripts/media/assets/hero-review-walkthrough-v2.vtt` |

### Documentation

| Old path                                      | New path                                            |
| --------------------------------------------- | --------------------------------------------------- |
| `apps/web/public/marketing/CONCEPT_ASSETS.md` | `docs/media-rights/marketing-concept-assets.md`     |
| `apps/web/public/marketing/faq/SOURCES.md`    | `docs/media-rights/faq-screenshot-sources.md`       |
| `docs/ASSET_LICENSE_AUDIT.md`                 | `docs/media-rights/asset-license-audit.md`          |
| `docs/DEPLOY_SUPABASE.md`                     | `docs/operations/database-supabase.md`              |
| `docs/DEPLOY_VERCEL.md`                       | `docs/history/2026-09-17-vercel-deploy-runbook.md`  |
| `docs/FRESH_START_RESET_2026-09-23.md`        | `docs/history/2026-09-23-fresh-start-reset.md`      |
| `docs/GOOGLE_SIGN_IN.md`                      | `docs/operations/google-sign-in.md`                 |
| `docs/SPEC_AMENDMENTS.md`                     | `docs/decisions/spec-amendments.md`                 |
| `docs/VENDOR_UI_REDESIGN.md`                  | `docs/design/vendor-ui-redesign.md`                 |
| `promotional-video-hindi-script.txt`          | `docs/marketing/promotional-video-hindi-script.txt` |

## Second pass (24–25 September 2026)

After newcomer reviewers walked the repository cold, a second pass grouped the admin components by
screen (mirroring the vendor dashboard), renamed files whose names misled readers, tidied
`packages/core` (admin-audit actor helpers now in `audit/actor.ts`), added ESLint rules that
enforce the `lib/` and `components/` boundaries, renamed `docs/compliance/` to
`docs/media-rights/`, and moved the outdated Vercel runbook into history. Local-only clutter
(`tmp/`, pulled production env files, a dead Vercel token) moved to the owner's private backup
folder outside the repository; Supabase's public CA certificate is now committed in
`scripts/supabase/`. The production build still lists the same 130 routes.

| Old path                                                                | New path                                                                                        |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `apps/web/app/api/v1/analytics/range-request.ts`                        | `apps/web/lib/analytics/range-request.ts`                                                       |
| `apps/web/components/admin/AbuseActions.tsx`                            | `apps/web/components/admin/businesses/AbuseActions.tsx`                                         |
| `apps/web/components/admin/ActivityFilters.tsx`                         | `apps/web/components/admin/activity/ActivityFilters.tsx`                                        |
| `apps/web/components/admin/ActivityTable.tsx`                           | `apps/web/components/admin/activity/ActivityTable.tsx`                                          |
| `apps/web/components/admin/AdminNav.tsx`                                | `apps/web/components/admin/shell/AdminNav.tsx`                                                  |
| `apps/web/components/admin/BusinessActions.tsx`                         | `apps/web/components/admin/businesses/BusinessActions.tsx`                                      |
| `apps/web/components/admin/PaymentFilters.tsx`                          | `apps/web/components/admin/payments/PaymentFilters.tsx`                                         |
| `apps/web/components/admin/PaymentsScreen.tsx`                          | `apps/web/components/admin/payments/PaymentsScreen.tsx`                                         |
| `apps/web/components/admin/PlatformSettingsForm.tsx`                    | `apps/web/components/admin/settings/PlatformSettingsForm.tsx`                                   |
| `apps/web/components/admin/PromptVersionEditor.tsx`                     | `apps/web/components/admin/ai/PromptVersionEditor.tsx`                                          |
| `apps/web/components/admin/SendPasswordResetButton.tsx`                 | `apps/web/components/admin/businesses/SendPasswordResetButton.tsx`                              |
| `apps/web/components/admin/TeamScreen.tsx`                              | `apps/web/components/admin/team/TeamScreen.tsx`                                                 |
| `apps/web/components/admin/business-tabs/index.tsx`                     | `apps/web/components/admin/businesses/BusinessTabs.tsx`                                         |
| `apps/web/components/dashboard/qr/__tests__/qr-sources.test.ts`         | `apps/web/components/dashboard/qr/__tests__/qr-screen-model.test.ts`                            |
| `apps/web/components/dashboard/qr/qr-sources.ts`                        | `apps/web/components/dashboard/qr/qr-screen-model.ts`                                           |
| `apps/web/components/dashboard/settings/__tests__/submit-state.test.ts` | `apps/web/components/dashboard/settings/__tests__/use-settings-submit.test.ts`                  |
| `apps/web/components/marketing/pricing/PricingDetails.module.css`       | `apps/web/components/marketing/pricing/PricingDetailsLink.module.css`                           |
| `apps/web/components/marketing/pricing/PricingDetails.tsx`              | `apps/web/components/marketing/pricing/PricingDetailsLink.tsx`                                  |
| `apps/web/lib/admin/business-detail/loaders.ts`                         | `apps/web/lib/admin/business-tab-loaders.ts`                                                    |
| `apps/web/lib/auth/helpers.ts`                                          | `apps/web/lib/auth/password-hasher.ts`                                                          |
| `apps/web/lib/crm/customers/__tests__/query.test.ts`                    | `apps/web/lib/crm/customers/__tests__/list-params.test.ts`                                      |
| `apps/web/lib/crm/customers/query.ts`                                   | `apps/web/lib/crm/customers/list-params.ts`                                                     |
| `apps/web/lib/crm/review-requests/__tests__/service-scope.test.ts`      | `apps/web/lib/crm/review-requests/__tests__/repository-scope.test.ts`                           |
| `apps/web/lib/crm/review-requests/service.ts`                           | `apps/web/lib/crm/review-requests/repository.ts`                                                |
| `apps/web/lib/qr/__tests__/qr-source.test.ts`                           | `apps/web/lib/qr/__tests__/qr-source-api.test.ts`                                               |
| `apps/web/lib/qr/qr-source.ts`                                          | `apps/web/lib/qr/qr-source-api.ts`                                                              |
| `docs/compliance/asset-license-audit.md`                                | `docs/media-rights/asset-license-audit.md`                                                      |
| `docs/compliance/faq-screenshot-sources.md`                             | `docs/media-rights/faq-screenshot-sources.md`                                                   |
| `docs/compliance/marketing-concept-assets.md`                           | `docs/media-rights/marketing-concept-assets.md`                                                 |
| `docs/compliance/robot-artwork-prompts.md`                              | `docs/media-rights/robot-artwork-prompts.md`                                                    |
| `docs/operations/deploy-vercel.md`                                      | `docs/history/2026-09-17-vercel-deploy-runbook.md`                                              |
| `packages/core/src/__tests__/audit-writer.test.ts`                      | `packages/core/src/audit/__tests__/writer.test.ts`                                              |
| `packages/core/src/__tests__/razorpay.test.ts`                          | `packages/core/src/billing/__tests__/razorpay.test.ts`                                          |
| `packages/core/src/abuse/service.ts`                                    | `packages/core/src/abuse/abuse-service.ts`                                                      |
| `apps/web/components/dashboard/ai-review/styles.ts`                     | merged into `apps/web/components/dashboard/link-styles.ts` and `ai-review/AiReviewSettings.tsx` |

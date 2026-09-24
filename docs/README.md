# Documentation

Everything written about Ai Review, by topic. Start with the [README](../README.md) if you have not
read it. Documents describe the code as it is now unless they sit under [`history/`](history/) or are
marked as partly historical at the top.

## Architecture

How the system is put together.

| Document                                               | Read it for                                                              |
| ------------------------------------------------------ | ------------------------------------------------------------------------ |
| [Overview](architecture/overview.md)                   | The moving parts, how they depend on each other, hosting, repository map |
| [Routes](architecture/routes.md)                       | Every page and API endpoint, grouped by audience                         |
| [Data model and analytics](architecture/data-model.md) | Tables by domain, the analytics event taxonomy, what analytics can claim |
| [Security](architecture/security.md)                   | Authentication, tenancy, admin MFA, CSRF, rate limits, privacy           |

## Features

How each part of the product behaves, end to end, and where its code lives.

| Document                                                 | Covers                                                             |
| -------------------------------------------------------- | ------------------------------------------------------------------ |
| [Vendor onboarding](features/vendor-onboarding.md)       | Sign-up, the onboarding wizard, publishing, the public page and QR |
| [Customer review flow](features/customer-review-flow.md) | QR scan → services → editable draft → confirm → copy → Google      |
| [Ai generation](features/ai-generation.md)               | Prompts, review modes, draft language, quotas, providers           |
| [Billing and plans](features/billing-and-plans.md)       | Free and Pro, Razorpay checkout, invoices, refunds, renewals       |
| [Feedback and CRM](features/feedback-and-crm.md)         | Private feedback inbox, customer list, review requests             |

## Operations

Running, testing, configuring and deploying. Deployments and migrations against shared databases
need the project owner's approval.

| Document                                                           | Covers                                                           |
| ------------------------------------------------------------------ | ---------------------------------------------------------------- |
| [Local development](operations/local-development.md)               | Setting up, the local stack, seeding, commands with side effects |
| [Testing](operations/testing.md)                                   | Unit, integration and browser tests; the CI pipeline             |
| [Environment variables](operations/environment.md)                 | Every variable by name and purpose                               |
| [Email and scheduled jobs](operations/email-and-scheduled-jobs.md) | Transactional email, Vercel Cron jobs, the optional worker       |
| [Deployment checklist](operations/deployment-checklist.md)         | What to confirm before and after a deployment                    |
| [Deploying to Vercel](operations/deploy-vercel.md)                 | The Vercel runbook (partly historical)                           |
| [Database on Supabase](operations/database-supabase.md)            | The hosted PostgreSQL runbook and cutover record                 |
| [Google sign-in](operations/google-sign-in.md)                     | Setting up and verifying Google sign-in for vendors              |

## Reference

| Document                                           | What it is                                                           |
| -------------------------------------------------- | -------------------------------------------------------------------- |
| [API contract](openapi/README.md)                  | OpenAPI description of the public and vendor API (`openapi/v1.yaml`) |
| [Spec amendments](decisions/spec-amendments.md)    | Every change to the original spec, with IDs cited in code comments   |
| [Original spec pack](spec/README_FIRST.md)         | The delivered product and engineering spec (frozen; do not edit)     |
| [Vendor UI redesign](design/vendor-ui-redesign.md) | Design decisions and tokens for the vendor workspace                 |
| [Known issues](known-issues.md)                    | Open problems and pending owner decisions                            |

## Compliance and marketing

| Document                                                           | What it is                                              |
| ------------------------------------------------------------------ | ------------------------------------------------------- |
| [Asset licence audit](compliance/asset-license-audit.md)           | Where every image, video and font came from, and rights |
| [Marketing concept assets](compliance/marketing-concept-assets.md) | Provenance of generated marketing artwork               |
| [FAQ screenshot sources](compliance/faq-screenshot-sources.md)     | How each FAQ screenshot was captured                    |
| [Robot artwork prompts](compliance/robot-artwork-prompts.md)       | Prompt log for the robot illustrations                  |
| [Marketing material](marketing/README.md)                          | The parked promotional video and its script             |

## History

Dated records. They quote file paths as they were at the time.

| Document                                                                          | What it is                                          |
| --------------------------------------------------------------------------------- | --------------------------------------------------- |
| [Changelog](history/changelog.md)                                                 | Dated notes on releases and decisions, newest first |
| [2026-09-24 repository restructure](history/2026-09-24-repository-restructure.md) | Why the layout changed, and an old → new path map   |
| [2026-09-23 fresh-start reset](history/2026-09-23-fresh-start-reset.md)           | The owner-requested production data reset           |

## Folder READMEs

Each code area has its own README: [`apps/web`](../apps/web/README.md) (with
[`app/`](../apps/web/app/README.md), [`lib/`](../apps/web/lib/README.md) and
[`components/`](../apps/web/components/README.md)), [`apps/worker`](../apps/worker/README.md),
[`packages`](../packages/README.md), [`scripts`](../scripts/README.md) and [`e2e`](../e2e/README.md).

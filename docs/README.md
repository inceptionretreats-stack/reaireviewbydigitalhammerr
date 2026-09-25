# Documentation

Everything written about Ai Review, by topic. Start with the [README](../README.md) if you have not
read it. Documents describe the product and code as they are now, unless they sit under
[`history/`](history/README.md) or say at the top that they are partly historical.

## For non-developers

Written in plain language, for owners, partners and managers. No code knowledge needed.

| Document                                                                            | Read it for                                                                                |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| [Product overview](product/README.md)                                               | What Ai Review does, who uses it, the plans, what it promises and does not                 |
| [Glossary](glossary.md)                                                             | The words used across the project, including ones with more than one meaning               |
| [Product decisions](decisions/product-decisions.md)                                 | What the owner has approved and must not be undone by accident                             |
| [Open decisions](decisions/open-decisions.md)                                       | Questions only the owner can answer: refunds, seller and tax details, and more             |
| [Customer review flow: ground rules](features/customer-review-flow.md#ground-rules) | The customer-side promises: no star ratings, nothing posted for them, feedback open to all |
| [Marketing material](marketing/README.md)                                           | The parked promotional video and its script                                                |
| [Media rights](media-rights/README.md)                                              | Where every image, video and font came from, and the right to use it                       |
| [Changelog](history/changelog.md)                                                   | What changed and when, newest first                                                        |

## Decisions and open problems

| Document                                            | What it is                                                                        |
| --------------------------------------------------- | --------------------------------------------------------------------------------- |
| [Decisions index](decisions/README.md)              | How the decision records fit together                                             |
| [Product decisions](decisions/product-decisions.md) | The owner's approved "do not undo" decisions, with the files they live in         |
| [Open decisions](decisions/open-decisions.md)       | Pending owner decisions                                                           |
| [Spec amendments](decisions/spec-amendments.md)     | Every change to the original spec, with the IDs cited in code comments            |
| [Known issues](known-issues.md)                     | Open defects and gaps found in the code                                           |
| [Original spec pack](spec/README_FIRST.md)          | The delivered product and engineering spec of 29 August 2026 (frozen; never edit) |

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

Running, testing, configuring and deploying. Deployments, and migrations against any shared or
production database, need the project owner's approval.

| Document                                                           | Covers                                                           |
| ------------------------------------------------------------------ | ---------------------------------------------------------------- |
| [Local development](operations/local-development.md)               | Setting up, the local stack, seeding, commands with side effects |
| [Testing](operations/testing.md)                                   | Unit, integration and browser tests; the CI pipeline             |
| [Environment variables](operations/environment.md)                 | Every variable by name and purpose                               |
| [Email and scheduled jobs](operations/email-and-scheduled-jobs.md) | Transactional email, Vercel Cron jobs, the optional worker       |
| [Deployment checklist](operations/deployment-checklist.md)         | What to confirm before and after a deployment                    |
| [Database on Supabase](operations/database-supabase.md)            | The hosted PostgreSQL runbook: connections, later migrations     |
| [Google sign-in](operations/google-sign-in.md)                     | Setting up and verifying Google sign-in for vendors              |

## Developer reference

| Document                                           | What it is                                                           |
| -------------------------------------------------- | -------------------------------------------------------------------- |
| [API contract](openapi/README.md)                  | OpenAPI description of the public and vendor API (`openapi/v1.yaml`) |
| [Vendor UI redesign](design/vendor-ui-redesign.md) | Design decisions and tokens for the vendor workspace                 |

## Media rights and marketing

| Document                                                             | What it is                                              |
| -------------------------------------------------------------------- | ------------------------------------------------------- |
| [Media rights index](media-rights/README.md)                         | How the rights and provenance records fit together      |
| [Asset licence audit](media-rights/asset-license-audit.md)           | Where every image, video and font came from, and rights |
| [Marketing concept assets](media-rights/marketing-concept-assets.md) | Provenance of generated marketing artwork               |
| [FAQ screenshot sources](media-rights/faq-screenshot-sources.md)     | How each FAQ screenshot was captured                    |
| [Robot artwork prompts](media-rights/robot-artwork-prompts.md)       | Prompt log for the robot illustrations                  |
| [Marketing material](marketing/README.md)                            | The parked promotional video and its script             |

## History

Dated records. They quote file paths as they were at the time.

| Document                                                                          | What it is                                                          |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| [History index](history/README.md)                                                | What the history folder holds                                       |
| [Changelog](history/changelog.md)                                                 | Dated notes on releases and decisions, newest first                 |
| [2026-09-24 repository restructure](history/2026-09-24-repository-restructure.md) | Why the layout changed, and an old → new path map                   |
| [2026-09-23 Supabase cutover](history/2026-09-23-supabase-cutover.md)             | Evidence from moving the production database to Supabase            |
| [2026-09-23 fresh-start reset](history/2026-09-23-fresh-start-reset.md)           | The owner-requested production data reset                           |
| [2026-09-17 Vercel deploy runbook](history/2026-09-17-vercel-deploy-runbook.md)   | The first Vercel runbook (Neon and Upstash era); superseded in part |

## Folder READMEs

Each code area has its own README: [`apps/web`](../apps/web/README.md) (with
[`app/`](../apps/web/app/README.md), [`lib/`](../apps/web/lib/README.md) and
[`components/`](../apps/web/components/README.md)), [`apps/worker`](../apps/worker/README.md),
[`packages`](../packages/README.md) (with [`analytics`](../packages/analytics/README.md),
[`config`](../packages/config/README.md), [`contracts`](../packages/contracts/README.md),
[`core`](../packages/core/README.md), [`db`](../packages/db/README.md) and
[`ui`](../packages/ui/README.md)), [`scripts`](../scripts/README.md) and [`e2e`](../e2e/README.md).
AI coding agents start at [`AI_HANDOVER.md`](../AI_HANDOVER.md).

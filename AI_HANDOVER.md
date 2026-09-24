# Ai Review by Digital Hammerr — brief for AI agents

Ai Review is a multi-tenant SaaS for local businesses. A business owner ("vendor") signs up,
completes onboarding (business details, Google review link, optional contact links and Ai context),
publishes a public page and prints a dynamic QR code. A customer scans it, picks one or more of the
business's services, explicitly asks for an editable Ai-drafted review, confirms it reflects their
genuine experience, copies it, and decides whether to open Google and post it themselves; they can
leave private feedback instead. Platform staff use an MFA-protected admin console. **The product
never posts reviews, never verifies posting, never collects star ratings and never promises more
reviews**; analytics describe observable actions only (scan, generate, copy, Google opened). Plans
are Free and Pro (yearly, via Razorpay). The whole app, UI and API, is one Next.js app in `apps/web`.

This file is the short brief and ground rules. Details live in `docs/`; everything dated
(releases, deployments, test counts, the database cutover, the production data reset) is in the
[changelog](docs/history/changelog.md).

## Read these first

1. [README.md](README.md) — what the project is, the repository map, how to run it.
2. [CONTRIBUTING.md](CONTRIBUTING.md) — where code goes, conventions, tests, commits.
3. [docs/README.md](docs/README.md) — index of every document by topic.
4. [apps/web/AGENTS.md](apps/web/AGENTS.md) — this Next.js version differs from your training data.
5. [docs/known-issues.md](docs/known-issues.md) — open defects and pending owner decisions.

Then read the doc for the area you are touching and the current source. Docs are snapshots; where
they disagree with the code, the code wins.

## 1. First instructions

1. Run `git status --short` and read the relevant diffs before editing. Preserve existing work: do
   not reset, clean, stash, blanket-stage or overwrite changes you did not make.
2. The owner asked to approve each proposed change and not to change the core idea. Treat an explicit
   request as approval for that named scope only, and ask before expanding it.
3. Ask before any migration, deployment, paid action, message or email to real people, DNS or
   Cloudflare change, provider or account change, production data change or destructive operation.
   A recommendation or known issue in the docs is not authorisation.
4. Before changing web code, read the relevant guide in `apps/web/node_modules/next/dist/docs/` for
   the installed Next.js 16, not what you remember of older versions.
5. Keep the approved architecture: Next.js route handlers and the app's own PostgreSQL-backed
   authentication on the existing Vercel project and account; PostgreSQL on the owner's Supabase Free
   project; the existing Redis and provider integrations. Do not move authentication to Supabase Auth
   or reopen the retired Neon database without a separately reviewed plan.
6. Never copy `.env`, `.env.local`, `.vercel/` exports, credentials, production data or secret-bearing
   logs into docs, chat, screenshots, commits or deployment uploads. Refer to variables by name.
7. Keep four states apart when reporting: **implemented locally**, **tested locally**, **documented
   historically** and **verified live**. They are not interchangeable (see
   [testing](docs/operations/testing.md#reporting-verification-honestly)).

## 2. Decisions: do not accidentally undo these

**Core product rules**

- The customer flow is services first: pick services, then explicitly create a draft; a saved draft
  is reachable through "Return to draft". No star-selection screen, rating gate or positive-only
  routing. Private feedback stays available to everyone.
- Never say a review was "submitted" or "posted" (lint rule AC-025 in `eslint.config.mjs`); the
  product only knows Google was opened. No growth or results promises.

**Marketing site**

- User-facing product casing is **Ai**, not AI. Keep technical identifiers such as
  `AI_PROVIDER_UNAVAILABLE` and the vendor name OpenAI. The hero sentence was supplied by the owner
  as `Review Likhna Ab Easy Hai — AI Hai Na.`
  (`apps/web/components/marketing/home/HomeMarketingPage.tsx`); do not silently rewrite approved
  copy during unrelated work.
- Keep the Hinglish hero, readable spacing, strong typography, the blue/Google-colour theme and the
  robot artwork. The owner asked for robots, not a girl, in illustrative website content.
- Keep How it works in **three steps** with full phones visible, thin bezels and video explanations
  (`apps/web/components/marketing/home/HowItWorksVideos.tsx`). Do not restore an eight-step grid or
  replace real product screenshots with generic mockups.
- The business-type strip above How it works is an infinite business-category marquee
  (`apps/web/components/marketing/home/BusinessAudienceStrip.tsx`), not customer logos or
  testimonials. Never present categories as real named customers.
- Visible demo branding uses Digital Hammerr, a digital marketing company (app and website
  development, SEO, graphic design), never a cafe. Some internal seeded identifiers still contain
  `demo-south-cafe`; changing identifiers can break references and is not a cosmetic edit.
- Unsupported claims such as `10X in 90 days` and timed-completion promises were removed. Do not
  reintroduce them without evidence and approval.
- The shopkeeper promotional story video is **not mounted** because its claims and dialogue were not
  verified (`apps/web/components/marketing/parked/ReviewStoryVideo.tsx`, see
  [marketing material](docs/marketing/README.md)). Its component and media are kept. This is separate
  from permission to use the media.

**Plans and pricing**

- Free is 10 Ai drafts in total per business profile. Standard Pro is INR 999 for 12 calendar months
  with 2,000 Ai drafts per paid period. Public pages read these from `platform_settings`
  (`apps/web/lib/marketing/commercial-terms.ts`). Do not restore unlimited Pro or describe the
  allowance as verified posted reviews.
- The original detailed billing block must **not** appear beneath the homepage cards, and the cards
  must **not** expand inline.
- Each pricing card's `Show more` link goes to `/legal/pricing`
  (`apps/web/components/marketing/pricing/PricingDetails.tsx`): one page explaining Free and Pro
  together, a comparison table beneath the plan details, and a `Back to pricing` link to
  `/#pricing`. Cards stay the same size. `/legal/pricing/free` and `/legal/pricing/pro` redirect to it.
- Footer links expose Privacy, Terms, Cancellation / Refunds and Contact without login
  (`apps/web/lib/marketing/public-information.ts`). The sign-up form's Terms and Privacy links open a
  new tab so typed fields and the checkbox are kept (`apps/web/components/auth/SignupForm.tsx`).

**Vendor workspace**

- Vendor screens use scoped navy-sidebar / light-workspace styling
  (`apps/web/components/dashboard/shell/VendorWorkspace.module.css`); onboarding has its own scoped
  module (`apps/web/components/onboarding/VendorOnboarding.module.css`). Keep equal dashboard card
  pairs and aligned bottom actions. The landing page, customer review page and admin styles are not
  targets of these vendor overrides.
- Keep all 11 working vendor navigation links (`apps/web/components/dashboard/shell/nav-items.ts`);
  unavailable placeholder entries stay hidden. Setup progress reflects all five real onboarding steps,
  including truthful publication status. See [vendor UI redesign](docs/design/vendor-ui-redesign.md).

**Operations**

- Email sender-domain/DNS verification was paused by the owner. Do not resume Cloudflare or DNS
  changes without permission.
- Do not restore the accounts removed in the 23 September 2026 production reset, and do not run the
  demo seed against production.

## 3. Deploying: the essentials

Full list: [deployment checklist](docs/operations/deployment-checklist.md).

- Do not deploy because a document mentions deployment. Ask the owner for the target and permission.
- Deploy only to the owner-designated Vercel account and project (Root Directory `apps/web`,
  functions in `sin1`); confirm the link and settings first. Production is served at the
  owner-specified domain `aireview.digitalhammerr.com`.
- Build locally, deploy without moving the live domain, verify, then promote. Uploads use archive
  mode because of the marketing media. Review `.vercelignore` before uploading. Keep Git metadata
  intact; never bypass access controls or rewrite history to get a deployment through.
- Migrations run through `DIRECT_DATABASE_URL`, before the code that needs them, with the owner's
  approval. Never apply migrations to a guessed database, and never log connection strings.
- Deploy coupled change sets together (for example the maintenance cron, worker export, schema and
  migration `0007`), and do not blanket-commit unrelated work to include your change.
- Record what you deployed and what you did **not** verify live in the
  [changelog](docs/history/changelog.md).

## 4. Where to look

| About to…                               | Read                                                                                   |
| --------------------------------------- | -------------------------------------------------------------------------------------- |
| Run the app or a script                 | [Local development](docs/operations/local-development.md) (side-effect table included) |
| Change routes, data, auth or tenancy    | [Architecture docs](docs/README.md#architecture)                                       |
| Change a feature                        | [Feature docs](docs/README.md#features)                                                |
| Add or rely on an environment variable  | [Environment](docs/operations/environment.md)                                          |
| Touch email, cron or the worker         | [Email and scheduled jobs](docs/operations/email-and-scheduled-jobs.md)                |
| Understand why the spec and code differ | [Spec amendments](docs/decisions/spec-amendments.md); `docs/spec/` is frozen           |
| Find out what happened when             | [Changelog](docs/history/changelog.md)                                                 |

## 5. Copy-paste brief for the next AI

> Read AI_HANDOVER.md, apps/web/AGENTS.md, docs/known-issues.md and the relevant current source
> before changing this project. First summarize the requested change and inspect git status and
> diffs. Preserve the dirty worktree, the existing stack and the customer-controlled review idea. Ask
> me before changes outside my explicit request, migrations, deployment, account/provider/DNS
> changes, paid actions or destructive operations. Never reveal secrets or seed real user data. Keep
> pricing cards compact: Show more navigates to the shared Free/Pro details and comparison page, not
> inline expansion. Do not claim Google reviews were posted or promise guaranteed growth. Test the
> actual affected flow on desktop and mobile where relevant, and clearly distinguish local completion
> from live deployment. Report blockers and remaining risks honestly.

Suggested continuation order, subject to the owner's approval:

1. Confirm the next requested task; no known issue is automatically authorised.
2. Resolve the refund and seller/tax decisions with the owner.
3. Add failing tests, then fix the billing and quota lifecycle issues in
   [known issues](docs/known-issues.md) before calling billing launch-ready.
4. Fix the authentication and public-request ownership issues, with regression tests.
5. Resume email/DNS verification and maintenance deployment only when the owner says so.
6. Deploy only the reviewed, approved change set to the verified account and project.

To hand this project to another AI, share this file and access to the source. Provide secrets
separately through a secure environment, never by pasting `.env` or a database into a conversation.

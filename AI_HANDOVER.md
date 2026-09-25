# Ai Review by Digital Hammerr — brief for AI agents

Ai Review is a multi-tenant SaaS for local businesses. A business owner ("vendor") signs up,
completes onboarding (business details, Google review link, optional contact links and Ai context),
publishes a public page and prints a dynamic QR code. A customer scans it, picks one or more of the
business's services, explicitly asks for an editable Ai-drafted review, confirms it reflects their
genuine experience, copies it, and decides whether to open Google and post it themselves; they can
leave private feedback instead. Platform staff use an admin console that asks for an authenticator
code (MFA) by default; `ADMIN_MFA_REQUIRED` can switch that off, so check the deployed value before
claiming MFA is enforced. **The product never posts reviews, never verifies posting, never collects
star ratings and never promises more reviews**; analytics describe observable actions only (scan,
generate, copy, Google opened). Plans are Free and Pro (yearly, via Razorpay). The whole app, UI and
API, is one Next.js app in `apps/web`.

This file is the short brief and ground rules. Details live in `docs/`; everything dated
(releases, deployments, test counts, the database cutover, the production data reset) is in the
[changelog](docs/history/changelog.md).

## Read these first

1. [README.md](README.md) — what the project is, the repository map, local-only folders, how to run
   it.
2. [CONTRIBUTING.md](CONTRIBUTING.md) — where code goes, conventions, the checks CI runs, commits.
3. [docs/README.md](docs/README.md) — index of every document by topic.
4. [apps/web/AGENTS.md](apps/web/AGENTS.md) — this Next.js version differs from your training data.
5. [Product decisions](docs/decisions/product-decisions.md) — the owner's approved decisions; do not
   undo them.
6. [Known issues](docs/known-issues.md) and [open decisions](docs/decisions/open-decisions.md) —
   open defects, and questions only the owner can answer.

Then read the doc for the area you are touching and the current source. Docs are snapshots; where
they disagree with the code, the code wins. Words such as tenant, slug or draft are defined in the
[glossary](docs/glossary.md).

## 1. First instructions

1. Run `git status --short` and read the relevant diffs before editing. Preserve existing work: do
   not reset, clean, stash, blanket-stage or overwrite changes you did not make. Two things are
   noise, not someone's work: `apps/web/next-env.d.ts` flips between `.next/types` and
   `.next/dev/types` whenever `next build` or `next dev` runs (never commit the dev version), and
   `warning: ignoring broken ref refs/codex/…` lines come from an earlier Codex session on this
   machine (harmless; do not delete them without approval).
2. The owner asked to approve each proposed change and not to change the core idea. Treat an explicit
   request as approval for that named scope only, and ask before expanding it.
3. **Approvals.** Ask the owner before generating a new migration and before running any
   migration, on any database. That includes `pnpm dev:up`, which runs migrations on every start
   against `DIRECT_DATABASE_URL` when it is set and `DATABASE_URL` otherwise. Also ask before
   running the seed, `pnpm test:integration` or `pnpm e2e` against the owner's own local database:
   the owner has not confirmed it is disposable. And ask before any deployment, paid action, message
   or email to real people, DNS or Cloudflare change, provider or account change, production data
   change, or destructive operation. A recommendation or known issue in the docs is not
   authorisation. Whether agents may migrate or seed a local database of their own without
   asking is an
   [open decision](docs/decisions/open-decisions.md#approval-for-local-migrations-and-seeding).
4. Before changing web code, read the relevant guide in `apps/web/node_modules/next/dist/docs/` for
   the installed Next.js 16, not what you remember of older versions.
5. Keep the approved architecture: Next.js route handlers and the app's own PostgreSQL-backed
   authentication on the existing Vercel project and account; PostgreSQL on the owner's Supabase Free
   project; the existing Redis and provider integrations. Do not move authentication to Supabase Auth
   or reopen the retired Neon database without a separately reviewed plan.
6. **Secrets.** Never copy any `.env*` file other than `.env.example` (including `.env`,
   `.env.local` and `.env.supabase.local`), anything under `.vercel/`, credentials, production data
   or secret-bearing logs into docs, chat, screenshots, commits or deployment uploads. Refer to
   variables by name. Never overwrite, regenerate or delete the root `.env`: it holds `HASH_PEPPER`,
   and replacing it makes every locally stored password fail to verify.
7. Keep four states apart when reporting: **implemented locally**, **tested locally**, **documented
   historically** and **verified live**. They are not interchangeable (see
   [testing](docs/operations/testing.md#reporting-verification-honestly)).
8. **Branches.** Branch from `main` and open pull requests against `main`; CI runs on pull requests
   and on pushes to `main`. If the checked-out branch is ahead of `main`, ask the owner which to
   build on. Do not push, merge or force-push without the owner's go-ahead.

### Commands with side effects

Check [the full table](docs/operations/local-development.md#commands-with-side-effects) before
running any `pnpm` script. The ones that surprise agents:

- `pnpm dev:up` runs migrations (against `DIRECT_DATABASE_URL`, or `DATABASE_URL` when that is
  blank), opens a **public** tunnel and rewrites `APP_BASE_URL` / `API_BASE_URL` in `.env`. Because
  it migrates, ask before running it.
- `pnpm dev:down` on Windows kills **every** `cloudflared.exe` and whatever listens on port 3000.
- `pnpm dev` also starts `apps/worker`, which schedules maintenance jobs against the database. Use
  `pnpm --filter @ai-review/web dev` for the web app alone.
- The seed resets the demo owner's password and prints it; `pnpm test:integration` and `pnpm e2e`
  write to the `DATABASE_URL` database. `pnpm db:migrate` and `pnpm seed` do not read `.env`, and
  `node --env-file=.env --run …` does not pass it on either; use the canonical commands in
  [local development](docs/operations/local-development.md#first-time-setup).
- `pnpm format` rewrites every file Prettier covers; format only your own files.
- `pnpm admin:create` and `pnpm ai:model` change real data in the database `.env` names. The payment
  tools in `scripts/ops/` (`reconcile-payment.mjs`, `mark-payment-failed.mjs`) do not read `.env`:
  they change data in whatever database their `DATABASE_URL` is given (usually production) and
  call Razorpay.

### Local-only files

The working folder holds git-ignored items a clone does not have: `.env`, `.env.supabase.local`,
`.vercel/`, `.pgdata/` (the local database), `.dev/` (dev-stack logs), `node_modules/`,
`apps/web/.next/`, `.agents/` and `skills-lock.json`. The README explains each one in
[local-only folders](README.md#local-only-folders-you-may-see). One-off Supabase cutover scripts,
a portable PostgreSQL client and pulled production settings are kept in the owner's private backup
folder outside the repository. Nothing in the repository depends on them; do not recreate them, and
do not go looking for them without the owner's request.

## 2. Product decisions: do not undo these

The full list, with the files each decision lives in, is
[product decisions](docs/decisions/product-decisions.md). Read it before touching the customer flow,
the marketing site, pricing, the vendor workspace or operations. The headline rules:

- **Services first, customer in control.** The customer picks services, then explicitly asks for a
  draft; a saved draft is reachable through "Return to draft". No star-selection screen, rating gate
  or positive-only routing. Private feedback stays available to everyone.
- **Never claim a review was submitted or posted.** The product only knows Google was opened. ESLint
  (rule AC-025 in `eslint.config.mjs`) catches "review submitted" wording but not "posted", so check
  your own text. No growth or results promises.
- **Brand casing is "Ai".** User-facing text says "Ai Review" and "Ai drafts"; technical identifiers
  such as `AI_PROVIDER_UNAVAILABLE` stay as they are. Do not silently rewrite owner-approved copy.
- **Plans.** Free is 10 Ai drafts per business in total; standard Pro is INR 999 for 12 months with
  2,000 drafts. Public pages read these from `platform_settings`. Do not restore unlimited Pro or
  describe the allowance as verified posted reviews.
- **Pricing cards stay compact.** Each card's `Show more` goes to the shared `/legal/pricing` page;
  cards never expand inline and the detailed billing block never appears beneath them.
- **Operations stay paused where the owner paused them.** Do not resume email DNS verification, do
  not restore the accounts removed in the 23 September 2026 production reset, and never run the demo
  seed against production.

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
| Change product behaviour or copy        | [Product decisions](docs/decisions/product-decisions.md)                               |
| Add or rely on an environment variable  | [Environment](docs/operations/environment.md)                                          |
| Touch email, cron or the worker         | [Email and scheduled jobs](docs/operations/email-and-scheduled-jobs.md)                |
| Understand why the spec and code differ | [Spec amendments](docs/decisions/spec-amendments.md); `docs/spec/` is frozen           |
| Find out what happened when             | [Changelog](docs/history/changelog.md)                                                 |

## 5. Copy-paste brief for the next AI

> Read AI_HANDOVER.md and the files in its "Read these first" list, then the relevant current
> source, before changing this project. First summarize the requested change and inspect git status
> and diffs. Preserve any uncommitted changes you did not make, the existing stack and the
> customer-controlled review idea. Ask me before changes outside my explicit request, before
> generating or running any migration (`pnpm dev:up` runs them), before seeding or running database
> tests against my local database, and before deployment, account/provider/DNS changes, paid
> actions or destructive operations. Never reveal secrets or seed real user data. Keep pricing cards
> compact: Show more navigates to the shared Free/Pro details and comparison page, not inline
> expansion. Do not claim Google reviews were posted or promise guaranteed growth. Test the actual
> affected flow on desktop and mobile where relevant, and clearly distinguish local completion from
> live deployment. Report blockers and remaining risks honestly.

The rules in sections 1 to 3 take precedence if this brief and those sections ever differ.

Suggested continuation order, subject to the owner's approval:

1. Confirm the next requested task; no known issue is automatically authorised.
2. Resolve the refund and seller/tax [open decisions](docs/decisions/open-decisions.md) with the
   owner.
3. Add failing tests, then fix the billing and quota lifecycle issues in
   [known issues](docs/known-issues.md) before calling billing launch-ready.
4. Fix the authentication and public-request ownership issues, with regression tests.
5. Resume email/DNS verification and maintenance deployment only when the owner says so.
6. Deploy only the reviewed, approved change set to the verified account and project.

To hand this project to another AI or person, share this file and access to the Git repository
(`git clone`), never a zip or copy of the working folder, which contains local secret files. Provide
secrets separately through a secure environment, never by pasting `.env` or a database into a
conversation.

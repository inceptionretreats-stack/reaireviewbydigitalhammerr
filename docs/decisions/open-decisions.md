# Open decisions

Business and operations decisions that only the project owner can make. None of them is a coding
task: until the project owner decides, do not invent an answer in code, in website copy or in a
document. Read this before calling the product launch-ready, before changing policy wording, and
before touching payments, email, hosting or search settings. Each entry says what is undecided, why
it matters to the business, and what the product does in the meantime.

This list moved here from `docs/known-issues.md` on 24 September 2026. Code defects are still in
[known issues](../known-issues.md); approved decisions are in
[product decisions](product-decisions.md).

| Decision                                                                                | Why it matters                                                     |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| [Refunds](#refunds)                                                                     | Paying businesses have no stated refund terms                      |
| [Seller and tax details](#seller-and-tax-details)                                       | Businesses receive a receipt, not a GST tax invoice                |
| [Privacy and retention](#privacy-and-retention)                                         | The privacy page cannot promise deletion times                     |
| [Email sender domain](#email-sender-domain)                                             | Password resets, receipts and reminders may not arrive             |
| [Payments mode](#payments-mode)                                                         | No real money can be collected                                     |
| [Hosting plan](#hosting-plan)                                                           | The hosting plan recorded at set-up does not allow commercial use  |
| [Search indexing](#search-indexing)                                                     | Neither the site nor any business page appears in search results   |
| [Launch verification](#launch-verification)                                             | The live setup has not been checked end to end                     |
| [Ai provider and running cost](#ai-provider-and-running-cost)                           | The cost analysis may not match the service actually used          |
| [Admin two-step sign-in](#admin-two-step-sign-in)                                       | Staff accounts are protected by a password alone, as last recorded |
| [Non-production database settings](#non-production-database-settings)                   | Preview copies of the site have no working database                |
| [Custom domains](#custom-domains)                                                       | Businesses cannot use their own web address                        |
| [Public media](#public-media)                                                           | An unapproved video can still be reached by direct link            |
| [Code ownership, licence and accounts](#code-ownership-licence-and-accounts)            | It is not recorded who owns the code and the service accounts      |
| [Approval for local migrations and seeding](#approval-for-local-migrations-and-seeding) | AI coding assistants must stop and ask before routine local set-up |

## Refunds

**Undecided:** the Pro refund window, who is eligible, and how long a refund takes.

**Business impact:** a business asking for its money back gets a case-by-case answer, and the public
[Cancellation and refunds page](https://aireview.digitalhammerr.com/legal/cancellation-refunds) says
the details are not yet confirmed.

**Meanwhile:** staff can issue full or partial refunds from the admin console. Do not add an
automatic refund or a blanket no-refund rule.

## Seller and tax details

**Undecided:** the legal seller identity, its address and its GST registration.

**Business impact:** until an admin enters a GST number (GSTIN) and state in the admin settings,
each payment produces a receipt with no GST split rather than a GST tax invoice. The defaults in
`packages/core/src/platform/settings.ts` name the seller "Digital Hammerr" with an empty address and
no GSTIN. The service accounting code on invoices (998314) also still needs an accountant's
confirmation.

**Meanwhile:** do not fill in tax details in code or copy; they are entered in `/admin/settings`
once confirmed.

## Privacy and retention

**Undecided:** how long each kind of data is kept, the deletion process, and a legal review of the
privacy text.

**Business impact:** the privacy page cannot promise deletion deadlines, and the product has not had
a legal review before taking real customers.

**Meanwhile:** do not promise erasure deadlines, exclusions from Ai-provider training, or
certifications.

## Email sender domain

**Undecided:** when to resume verifying the sending domain with Resend, the email service. The
project owner paused it.

**Business impact:** password-reset links, payment receipts, renewal reminders and staff invitations
may not be delivered, or may land in spam, until the domain is verified.

**Meanwhile:** resume only with the project owner's permission and access to the account that
controls the domain's DNS settings (its internet address settings, which tell other services where
its website and email live). When the work was paused, the Cloudflare account then in use
(Cloudflare is a service that can manage those settings) did not control the `digitalhammerr.com`
settings, and who does is not recorded. Do not change DNS or Cloudflare settings.

## Payments mode

**Decided for now:** as of 24 September 2026, production deliberately uses Razorpay test-mode
credentials, by the project owner's choice. This is not a defect.

**Business impact:** the full payment path works for rehearsal, but no real payment can be
collected.

**To go live:** switch to live Razorpay keys, re-register the payment webhook (the notification
Razorpay sends after a payment), and move to a hosting plan that permits commercial use, all
together and with approval. Fill in the [seller and tax details](#seller-and-tax-details) first.

## Hosting plan

**Undecided:** which hosting plan to use once businesses are charged.

**Business impact:** production was set up on Vercel's free Hobby plan, which Vercel licenses for
personal, non-commercial use only. Charging businesses needs Vercel's paid Pro plan or another host
(see the [historical Vercel runbook](../history/2026-09-17-vercel-deploy-runbook.md)).

**Meanwhile:** change the plan together with [payments mode](#payments-mode).

## Search indexing

**Undecided:** when to let search engines list the site.

**Business impact:** the whole app tells search engines not to index it (`robots: { index: false }`
in `apps/web/app/layout.tsx`). That covers the marketing site and every business's public page, so
none of them appears in search results.

**Meanwhile:** removing that setting is a launch decision, not a clean-up.

## Launch verification

**Undecided:** when to check the live setup before any launch claim.

**Business impact:** until each item is checked in production, no one can say the live product is
ready for paying businesses.

**To check in production:** the Ai provider and the active prompt (the Ai writing instructions in
use); the price and allowance settings; the admin two-step sign-in setting (`ADMIN_MFA_REQUIRED`);
payment credentials and webhooks; that the scheduled jobs run; which database migrations (updates
to the database structure) are applied; that Redis, the store that counts requests to block abuse,
is reachable; backup and restore; and email delivery.

## Ai provider and running cost

**Undecided:** which Ai service production should use and pay for.

**Business impact:** the only cost analysis
([AI unit economics](spec-amendments.md#ai-unit-economics--verified), August 2026) prices OpenAI's
`gpt-5.6-luna` model and puts Ai costs at about 4.6% of revenue. Production was last recorded, at
the first deployment on 12 September 2026, as using Google Gemini (`gemini-3.5-flash-lite`), and
that has not been re-checked since. The margin figures may therefore not apply. If Gemini's free
tier is used, Google's terms allow it to use the prompts to improve its products; prompts contain
the business's own details, not the customer's (AMENDMENT-024).

**Meanwhile:** re-check the live provider and model with the project owner's approval, and recompute
the costs before any pricing decision.

## Admin two-step sign-in

**Undecided:** when to require the second sign-in step (an authenticator-app code) for staff again.

**Business impact:** on 16 September 2026 the project owner asked for it to be switched off "for
now", so, as last recorded, staff accounts on the public site are protected by a password alone. The
feature is built; turning it back on is a setting (`ADMIN_MFA_REQUIRED`), not a code change
(AMENDMENT-027).

**Meanwhile:** the current live setting has not been re-checked; it is part of
[launch verification](#launch-verification).

## Non-production database settings

**Undecided:** which database preview copies of the site should use.

**Business impact:** the Vercel project's non-production database setting was recorded as still
pointing at the retired Neon database, which no longer accepts connections. A preview deployment
therefore has no working database, so a change cannot be tried out on a preview before it goes live.

**Meanwhile:** do not reopen the retired database to make a preview work.

## Custom domains

**Undecided:** whether and when to offer businesses their own web address for their page.

**Business impact:** the original spec promised custom domains (D-024), but they are not available:
the database tables and settings exist, yet nothing connects them to a working domain service. Do
not sell or advertise the feature.

## Public media

**Undecided:** whether to delete the parked shopkeeper story video and its poster from the public
folder.

**Business impact:** they are not shown on any page, but they are still reachable by anyone with
their direct address under `apps/web/public/marketing/`, and their claims were never verified.
Superseded marketing media was deleted on 24 September 2026 and remains in git history. See
[marketing material](../marketing/README.md).

## Code ownership, licence and accounts

**Undecided, or at least not recorded:** who owns the source code and under what licence; who
controls the GitHub account that stores it, which is a personal GitHub account (not an
organisation); and how the Inception accounts (which hold the Vercel hosting project and the Google
Cloud project) relate to Digital Hammerr (which holds the Supabase database organisation).

**Business impact:** a partner, investor or contractor cannot tell from the repository who owns the
product and its accounts. The repository has no licence file; `"private": true` in `package.json`
only prevents accidental publishing to the npm package registry.

**Meanwhile:** do not add a licence file, rename the repository or move accounts without the project
owner's decision. The known account holders are listed in the
[product overview](../product/README.md#accounts-and-services).

## Approval for local migrations and seeding

**Undecided:** whether AI coding assistants may, without asking the project owner first, update the
structure of a local database they set up themselves (run the database migrations) or fill it with
demo data (run the seed). Raised on 24 September 2026, when the assistant instructions were
rewritten; the recorded rule, ask before any migration, stands until the owner decides.

**Business impact:** until the project owner decides, an assistant has to stop and ask before
routine set-up steps, including starting the local app with `pnpm dev:up`, which updates the
database every time it starts. That slows everyday work. Allowing it without asking is only safe for
a database the assistant created itself: the owner has not confirmed that the database on their own
computer holds nothing worth keeping, and a wrongly configured setting could point these steps at
the live database instead.

**Meanwhile:** assistants ask before generating or running any migration, and before running the
seed or the database tests against the owner's local database, as the rules in
[AI_HANDOVER.md](../../AI_HANDOVER.md#1-first-instructions) say.

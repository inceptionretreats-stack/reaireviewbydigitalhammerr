# Glossary

Plain meanings of the words and IDs used in this repository's documents, code comments and screens.
Read it when a word seems to mean two different things, or when a comment cites an ID such as
`AC-025` or `DASH-01` and you want to know where that ID is defined. Where a term has a name in the
code, that name is given in `code style` so you can search for it.

The frozen spec has its own short glossary, [`spec/24_Glossary.md`](spec/24_Glossary.md). It is the
"glossary" that some code comments cite. It is out of date in places: it gives the old address
`review.digitalhammerr.com`, writes "AI" where the product now writes "Ai", and does not mention
Hinglish drafts, vendors or the project owner. Where the two disagree, this file describes the
product as it is now.

## Words with more than one meaning

### Owner

- **Project owner.** The person at Digital Hammerr who makes the product and business decisions and
  approves changes, deployments, spending and anything that touches live data. When
  `AI_HANDOVER.md`, the [known issues](known-issues.md) or the
  [open decisions](decisions/open-decisions.md) say "the owner", they mean this person.
- **Business owner.** The person who signs up a business and runs its account (see _Vendor_ below).
  In code, "owner" nearly always means this person: `lib/admin/owner-actions.ts`, the "owner
  preview" of a draft, the "Owner & account" tab in the admin console.
- Rule of thumb: if the sentence is about approving, deploying or deciding policy, it is the project
  owner; if it is about a business's account, screens or drafts, it is the business owner.

### Customer

- **A business's customer.** The member of the public who scans a business's QR code or opens its
  page. They never sign in and stay anonymous. This is what "customer" means in the customer review
  flow and in the code folders `app/(customer)`, `components/customer` and `lib/customer`, and in
  the `api/v1/public` endpoints.
- **A contact in the customer list.** A person a business owner has saved at `/app/customers` so
  they can send them a review request. Code: the `customers` table, `lib/crm/customers`,
  `api/v1/customers`.
- **Not the businesses.** The businesses are the ones who pay for Ai Review, but the documents call
  them businesses or vendors, never customers.

### Vendor, business owner and merchant

All three name the same person: someone who signs up and runs a business account. "Vendor" is the
code's word (`app/(vendor)`, `e2e/vendor`, "vendor workspace"), "business owner" is the product's
word and the database role (`BUSINESS_OWNER`), and "merchant" appears in the spec, older documents,
code comments and a few public texts (the Terms, the Cancellation and refunds page and the pricing
details page). Now and then "vendor" means a supplier instead, for example an Ai provider; the
sentence makes that clear.

### Business and tenant

- **Business.** One business account and its public profile: name, page address, Google review link,
  QR codes, plan and settings. In this version each business owner has one business.
- **Tenant.** The code's word for a business (`lib/tenant`, `requireTenant`). "Multi-tenant" means
  many businesses share one application while each can see only its own data.

### Draft

- **Ai draft** (also "Ai review draft", or "generation" in code). The editable review text the Ai
  writes when a customer asks for one. Each is stored as a row in `ai_generations`. A draft is not a
  review: it becomes one only if the customer pastes it on Google themselves, and the product cannot
  see whether they did.
- **DRAFT business status.** A business that has been set up but not yet published. The four
  statuses are `DRAFT`, `ACTIVE` (published), `SUSPENDED` and `CLOSED`.
- **DRAFT prompt version.** A set of Ai writing instructions that an admin has prepared but not yet
  switched on. Prompt versions move from `DRAFT` to `ACTIVE` to `ARCHIVED`.
- **"Draft limits".** The allowance of Ai drafts; see _Quota_ below.

### Quota, allowance and limit

These all mean the number of Ai drafts a business may use. The defaults are 10 in total on Free and
2,000 per paid year on Pro. The code says "quota" (`packages/core/src/quota/`) and the settings are
`free_generation_limit` and `pro_generation_limit`; screens and public pages say "Ai drafts" or
"draft allowance". A draft counts when it is successfully delivered to a customer, including a "New
review". Editing, copying, opening Google and the business owner's preview do not count.

### Dashboard

- **The business owner's workspace** at `/app`. The code calls the whole workspace "dashboard"
  (`components/dashboard/`, `lib/dashboard/`), although the routes live in `app/(vendor)`.
- **The overview screen**, the first screen of that workspace (screen `DASH-01`, at `/app`).
- **A provider's website.** Operations documents also mention the Vercel, Supabase and Razorpay
  dashboards: the control panels of those services.

The platform staff's console at `/admin` is called the admin console, not a dashboard.

### Pro

- **Our paid plan.** Pro costs ₹999 for 12 months and includes 2,000 Ai drafts by default.
- **Vercel Pro.** The paid plan of Vercel, the company that hosts the app. Production was set up on
  Vercel's free Hobby plan, which is for non-commercial use; moving to Vercel Pro or another host is
  part of going live (see [open decisions](decisions/open-decisions.md)).

### Shell

- **Shell business.** The placeholder business created the moment someone signs up, before they
  enter any details. Its category is `PENDING`, and it cannot be published until onboarding replaces
  the placeholders (`lib/tenant/tenant-shell.ts`, `isShell`).
- **UI shell.** The frame around a group of screens: navigation, header and layout
  (`components/dashboard/shell/`, `WizardShell`, `AuthShell.module.css`, `MarketingShell`).

### Frozen

- **Frozen spec.** The original specification in `docs/spec/`, delivered on 29 August 2026 and last
  updated on 10 September 2026, when the 2,000-draft Pro cap and "Ai" casing were written into it
  (decisions D-030 and D-031). It must not be edited now; later changes are recorded in
  [spec amendments](decisions/spec-amendments.md).
- **Frozen business.** A business an admin has suspended or closed (`SUSPENDED` or `CLOSED`). The
  code helper `refuseFrozenTenant` refuses changes from such a business.
- In the spec's Decision Log, the status "Frozen" simply means "decided".

### Preview

- **The business owner's test preview.** A trial draft the business owner can make on the Ai
  settings screen. It does not use the allowance and runs fewer checks than a real customer draft.
- **Preview deployment.** A non-production copy of the site on Vercel, used to check a change before
  it goes live.

### Admin

A member of Digital Hammerr's staff who uses the admin console at `/admin`. There are two roles:
`SUPER_ADMIN` (full access) and `BUSINESS_SUPPORT_VIEWER` (read-only). A business owner has no admin
rights.

## Other terms

- **Ai.** The product writes the acronym as "Ai" in everything users read (approved change
  CHANGE-002). Technical names keep "AI", for example `AI_PROVIDER_UNAVAILABLE`.
- **Ai context.** Facts a business gives the Ai about itself: a summary, its services, context terms
  and the draft language. Stored in `ai_business_contexts`.
- **Ai provider.** The outside Ai service that writes drafts: Anthropic, OpenAI or Google Gemini,
  chosen by which access key is configured. See also _Stub provider_.
- **Anonymous session.** How a customer's phone is recognised on a return visit without signing in:
  a cookie called `dh_anon` that lasts 30 days. It lets a customer get back to their saved draft.
- **Business page** (also "public page" or "profile"). The business's public page at
  `aireview.digitalhammerr.com/{slug}`, with its review button and contact buttons.
- **Confirmation.** The tick box a customer must check, confirming the draft reflects their genuine
  experience, before they can copy it.
- **Cron job.** A task the hosting service runs on a timetable, for example the nightly job that
  expires lapsed Pro years and sends renewal reminders.
- **CRM.** The customer list and review-request tools in the business owner's workspace. CRM stands
  for "customer relationship management".
- **Demo business.** An example business that the development seed creates on a developer's machine.
  Its internal identifiers contain `demo-south-cafe`. It must never be created in production.
- **Digital Hammerr.** The company behind Ai Review: a digital marketing company offering app and
  website development, SEO (search-engine optimisation) and graphic design.
- **Entitlement.** Whether a business has Pro right now, and why: bought with a payment (`PAYMENT`),
  granted by an admin (`ADMIN`), or neither (`NONE`).
- **GST.** India's Goods and Services Tax. Invoices show a GST split only once the seller's GST
  registration number (GSTIN) and state are entered in the admin settings.
- **Google opened.** The last step the product can observe: the customer tapped the button that
  opens the business's Google review page. It is not proof that a review was written.
- **Hinglish.** Everyday Hindi written in the Roman alphabet and mixed with English, the way many
  people in India write online. Hinglish is the default language for Ai drafts; each business can
  switch to English (`draft_language`: `hinglish` or `en`).
- **Inception.** The name of the account that holds the Vercel hosting project and the Google Cloud
  project used for Google sign-in. How it relates to Digital Hammerr is not recorded (see
  [open decisions](decisions/open-decisions.md)).
- **Invoice and receipt.** The document a business gets for each captured payment. It is titled a
  receipt, with no GST split, until the seller's GST details are entered.
- **MFA.** Multi-factor authentication: signing in with a password plus a code from an authenticator
  app. Built for admins; whether it is enforced is a setting (`ADMIN_MFA_REQUIRED`).
- **Migration.** A numbered file that changes the database structure (`packages/db/drizzle/`). Once
  applied to a database it is never edited.
- **Onboarding.** The five setup steps after sign-up: business details, Google review link, contact
  buttons, Ai settings, and finish (publish).
- **Parked.** Code or media that is kept in the repository but deliberately not shown anywhere, such
  as the shopkeeper story video (`components/marketing/parked/`).
- **Platform settings.** Values admins change at `/admin/settings` without a code change: the Pro
  price, the Free and Pro allowances, and the seller and tax details. Stored in `platform_settings`;
  every change is versioned and audited.
- **Private feedback.** A message a customer sends only to the business instead of writing a review.
  It is offered to every customer.
- **Prompt version.** A stored set of Ai writing instructions and the model to use, managed by
  admins at `/admin/ai`. Exactly one is active at a time.
- **Publish.** Making a business's page and QR codes live (status `ACTIVE`).
- **QR code.** The printed square code. It holds a short fixed link (`/r/{code}`), so the business
  can change where it leads without reprinting it. The spec calls this a dynamic QR.
- **QR source.** A labelled QR code, such as "Reception" or "Billing counter", so a business can see
  which printed code brought each scan.
- **Razorpay.** The Indian payment company that handles Pro payments and refunds.
- **Redis.** A fast shared store the app uses to count requests for rate limiting.
- **Resend.** The email service that sends password-reset links, receipts, renewal reminders and
  invites.
- **Review destination** (also "review link"). The Google address where a business's customers go to
  post their review. Stored in `review_destinations`.
- **Review mode.** A named emphasis for the Ai's wording, set by the business owner (for example
  Balanced). It never changes tone, sentiment or rating.
- **Review request.** A message a business owner prepares for a contact in the customer list and
  sends themselves, for example on WhatsApp. It carries a tracked link (`/r/req/{token}`).
- **Seed.** A script that fills a development database with example data. It refuses to run in
  production.
- **Services.** The list of things a business offers (for example "Haircut"). A customer picks one
  or more before asking for a draft, and the draft is written about those services.
- **Slug.** The business's part of its page address, as in `aireview.digitalhammerr.com/{slug}`. A
  few words are reserved for the platform's own pages.
- **Standee.** The printed stand or card that carries a business's QR code. The app produces a
  printable design for it.
- **Stub provider.** A stand-in for a real Ai service that returns fixed example drafts. Used on
  developer machines and in automated tests when no Ai key is set; production refuses to start
  without a real provider.
- **Supabase.** The service that hosts the production database, which runs on PostgreSQL (widely
  used database software). The app uses it as a plain database; sign-in is handled by the app
  itself.
- **Vercel.** The service that hosts the website and its API (the part of the app that other
  programs, including the app's own screens, call to read or save data), and runs its scheduled
  jobs.
- **Worker.** An optional background program in `apps/worker`. It is not deployed; the same
  maintenance jobs run as Vercel cron jobs instead.

## ID prefixes

Code comments and documents cite short IDs to say which requirement or decision a piece of code
serves. This table says what each prefix means and which file defines it.

| Prefix and example                                      | What it is                                                                                 | Defined in                                                                                                |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `AC-nnn`, e.g. `AC-025`                                 | An acceptance criterion: a rule the product must pass (AC-001 to 040)                      | [`spec/12_QA_Acceptance_Criteria.md`](spec/12_QA_Acceptance_Criteria.md)                                  |
| Screen ID plus two numbers, e.g. `QR-01-02`, `AN-01-01` | An acceptance criterion for one screen                                                     | [`spec/12_QA_Acceptance_Criteria.md`](spec/12_QA_Acceptance_Criteria.md)                                  |
| Screen IDs, e.g. `DASH-01`, `ONB-01`, `QR-01`           | One screen of the product (list below)                                                     | [`spec/03_Screen_Field_Button_Spec.md`](spec/03_Screen_Field_Button_Spec.md), one heading per screen      |
| `Flow A` to `Flow J`, e.g. `Flow C`                     | A user journey, such as the QR customer journey (Flow C)                                   | [`spec/04_User_Flows.md`](spec/04_User_Flows.md)                                                          |
| `E1` to `E13`, and stories such as `E10-06`             | An epic (a group of work) and a story inside it                                            | [`spec/17_Backlog_Epics_User_Stories.md`](spec/17_Backlog_Epics_User_Stories.md); useful for the IDs only |
| `D-nnn`, e.g. `D-009`                                   | A product decision in the spec: D-001 to D-029 original, D-030 and D-031 added 10 Sep 2026 | [`spec/22_Decision_Log.md`](spec/22_Decision_Log.md)                                                      |
| `ADR-nnn`, e.g. `ADR-008`                               | An original architecture decision (ADR-001 to ADR-011)                                     | [`spec/25_Architecture_Decisions_ADRs.md`](spec/25_Architecture_Decisions_ADRs.md)                        |
| `CHANGE-nnn`, e.g. `CHANGE-003`                         | A product change the project owner approved after the spec was frozen                      | [`decisions/spec-amendments.md`](decisions/spec-amendments.md), "Approved product changes"                |
| `AMENDMENT-nnn`, e.g. `AMENDMENT-027`                   | A technical correction or addition to the spec (AMENDMENT-001 to 030)                      | [`decisions/spec-amendments.md`](decisions/spec-amendments.md)                                            |
| `ADR-AMEND-x`, e.g. `ADR-AMEND-B`                       | A change to an original architecture decision (A, B and C)                                 | [`decisions/spec-amendments.md`](decisions/spec-amendments.md), "Architecture amendments"                 |
| `OPEN-nn`, e.g. `OPEN-03`                               | A gap found against the spec during the build (OPEN-01 to 07)                              | [`decisions/spec-amendments.md`](decisions/spec-amendments.md), "Open"; several are now resolved          |
| Known issue number, e.g. "known issue 17"               | A current open problem                                                                     | [`known-issues.md`](known-issues.md)                                                                      |

Screen IDs: `AUTH-01` to `03` (sign-up, sign-in, forgot password), `ONB-01` to `05` (onboarding
steps), `PUB-01` (business page), `REV-01` to `03` (customer review flow), `FB-01` (customer
feedback form), `DASH-01` (overview), `AI-01` (Ai review settings), `AI-02` (review modes), `QR-01`
(QR codes), `PROFILE-01` (business profile), `CRM-01` (customers), `REQ-01` (review requests),
`FB-02` (feedback inbox), `AN-01` (analytics), `DOM-01` (custom domain, not built), `SUB-01`
(subscription), `SET-01` (settings) and `ADMIN-01` to `04` (admin console). The workspace navigation
labels each item with its screen ID in `apps/web/components/dashboard/shell/nav-items.ts`.

# Ai Review: product overview

A plain-language introduction to Ai Review for people who do not write code: business partners,
managers, marketers and anyone else who needs to know what the product is, who it serves, what it
costs, whether it is live, and where the business documents are kept. No technical background is
needed. Words that may be unfamiliar are explained in the [glossary](../glossary.md).

## What Ai Review is

**Ai Review by Digital Hammerr** is an online service that helps local businesses get more genuine
Google reviews from their own customers. Digital Hammerr is a digital marketing company (app and
website development, SEO, meaning search-engine optimisation, and graphic design); Ai Review is its
product.

It works like this:

1. A business signs up on the website, enters its details and its Google review link, and prints a
   QR code (a square barcode a phone camera can read).
2. The business displays the QR code where customers pay or wait, for example on a counter stand.
3. A customer scans the code with their phone. They pick the services they used, then ask for a
   review draft. The Ai (artificial intelligence) writes a short draft review they can edit.
4. The customer confirms the draft reflects their real experience, copies it, and decides for
   themselves whether to open Google and post it. They can also send private feedback to the
   business instead.

What it deliberately does **not** do: it never posts a review for anyone, never checks whether a
review was posted, never asks for a star rating, and never promises a business more reviews or
better results. Its reports count only what it can see: scans, drafts, copies, and customers opening
Google. These rules keep the product within Google's review policies, which require reviews to
reflect genuine experiences, and they are part of its core design (see
[product decisions](../decisions/product-decisions.md)).

## Who uses it

| Who                       | What they do                                                                                                            |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Business owners**       | Sign up, set up their business, print QR codes, see feedback and simple reports, and pay for Pro. Also called "vendors" |
| **Their customers**       | Scan a QR code, get an editable Ai draft, or leave private feedback. They never create an account                       |
| **Digital Hammerr staff** | Manage businesses, payments, Ai writing rules, prices and the staff team in a separate admin console                    |
| **Visitors**              | Read the public website, pricing and policies                                                                           |

The paying clients are the businesses. When these documents say "customer" they usually mean a
business's customer, the person holding the phone.

## The market: Indian local businesses

Ai Review is built for independent local businesses in India: shops, restaurants, salons, clinics,
hotels and similar. That shows up throughout the product:

- Prices are in Indian rupees (₹), paid through **Razorpay**, an Indian payment company.
- Invoices are designed for India's GST (Goods and Services Tax).
- Dates default to Indian time.
- Ai drafts are written in **Hinglish** by default: everyday Hindi written in English letters and
  mixed with English words, the way many people in India write online reviews. Each business can
  switch its drafts to plain English. Apart from a few Hinglish lines on the homepage (the headline
  area and the How it works introduction), the website and screens are in English.

## The live site

The product is at **[aireview.digitalhammerr.com](https://aireview.digitalhammerr.com)**. That one
address serves:

- the public website, with pricing and the legal pages;
- sign-up and sign-in for business owners, and their workspace;
- each business's public page, at `aireview.digitalhammerr.com/<business-name>`, and the links
  inside its QR codes;
- the admin console for Digital Hammerr staff.

## Plans and prices

| Plan | Price                       | Ai drafts                                            |
| ---- | --------------------------- | ---------------------------------------------------- |
| Free | ₹0                          | 10 in total per business, never refilled             |
| Pro  | ₹999 for 12 calendar months | 2,000 per paid year; unused drafts do not carry over |

Pro is paid once a year; renewing is a new payment, not an automatic charge. When a business runs
out of drafts, its customers can still open Google and write their own review.

These are the default figures. Staff change the live price and allowances in the admin console's
settings screen, without any code change. What that does and does not update:

- The homepage pricing cards and the pricing details page show the current settings automatically.
- Checkout charges the current price.
- Four places state the figures as fixed text, so a developer must edit them if the figures change
  (known issue 19): the Terms page (₹999, 10 and 2,000), the Cancellation and refunds page (₹999
  for 12 calendar months), the plan notes in the business owner's workspace (10 and 2,000), and the
  renewal-reminder and Pro-expiry emails (2,000 drafts a year).
- A business's allowance is fixed when it signs up, so a change affects only new businesses unless
  each existing one is updated (known issue 17).

More detail, for developers: [billing and plans](../features/billing-and-plans.md).

## Launch status

The product is **deployed and publicly reachable, but not launched commercially**. As of 24
September 2026:

- **Payments run in Razorpay's test mode, by the project owner's choice.** The payment path is built
  and can be rehearsed, but no real money can be taken until live payment keys are switched on.
- **Search engines are told not to list the site**, including every business's public page.
- **The hosting was set up on Vercel's free Hobby plan, which does not allow commercial use**, and
  no change of plan is recorded.
- **Email sender-domain setup is paused** by the project owner, so email delivery is not confirmed.
- **Refund terms, seller and GST details, and data-retention rules are not yet decided.**
- **All earlier accounts were removed** from the live system on 23 September 2026 at the project
  owner's request, for a fresh start. Anything created since is real data.

Not yet verified on the live site: which Ai service is writing drafts and its current settings, the
live price and allowance settings, whether admins must use a second sign-in step, payment keys and
payment notifications, the scheduled jobs (renewal reminders, expiry, maintenance), whether the
latest database change is applied, the store that counts requests to block abuse (Redis), backup
and restore, email delivery, and a complete sign-in with Google through to onboarding. Business
owners' screens have been checked with test data on developers' machines, not with a real business
account on the live site.

Each of these is tracked in [open decisions](../decisions/open-decisions.md) and
[known issues](../known-issues.md).

## Accounts and services

The product relies on these outside services. This table records who holds each account as far as
the repository documents it; project IDs, logins and keys are deliberately not written down here.

| Service        | What it does for Ai Review                                | Account holder, as recorded                     | Plan or mode                             |
| -------------- | --------------------------------------------------------- | ----------------------------------------------- | ---------------------------------------- |
| Vercel         | Hosts the website and app, and runs its scheduled jobs    | The Inception account                           | Hobby (free, non-commercial) when set up |
| Supabase       | Hosts the database                                        | The Digital Hammerr organisation                | Free plan, Mumbai region                 |
| Google Cloud   | Powers "Sign in with Google" for business owners          | The Inception account                           | Not recorded                             |
| Razorpay       | Takes Pro payments and refunds                            | Not recorded                                    | Test mode                                |
| Resend         | Sends email: password resets, receipts, renewal reminders | Not recorded                                    | Sender-domain setup paused               |
| Ai provider    | Writes the drafts                                         | Not recorded                                    | Google Gemini when first set up          |
| Redis          | Counts requests to stop abuse (rate limiting)             | Upstash, added through Vercel when first set up | Free plan when set up                    |
| Domain and DNS | The `digitalhammerr.com` address and its DNS settings     | Not recorded                                    | —                                        |
| GitHub         | Stores the source code                                    | A personal GitHub account (not an organisation) | —                                        |

DNS settings are the domain's internet address settings: they tell browsers and email services
where the website and its email live. How the Inception accounts relate to Digital Hammerr, who owns
the code and controls the GitHub account, and under what licence are not recorded anywhere in the
repository; they are listed in [open decisions](../decisions/open-decisions.md). The Ai provider
was last recorded on 12 September 2026 and has not been re-checked since; the only cost analysis
assumes a different provider (see
[open decisions](../decisions/open-decisions.md#ai-provider-and-running-cost)).

## Where the business documents are

| You want                                                        | Go to                                                                                                                                                                                                          |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The approved product, website, pricing and operations decisions | [Product decisions](../decisions/product-decisions.md)                                                                                                                                                         |
| Decisions still waiting for the project owner                   | [Open decisions](../decisions/open-decisions.md)                                                                                                                                                               |
| How decisions are recorded, and the formal change record        | [Decisions index](../decisions/README.md) and [spec amendments](../decisions/spec-amendments.md)                                                                                                               |
| The Ai cost analysis                                            | [AI unit economics](../decisions/spec-amendments.md#ai-unit-economics--verified) (dated August 2026; re-check before any pricing decision)                                                                     |
| The original business requirements (frozen spec)                | [Spec pack](../spec/README_FIRST.md) (delivered 29 August 2026, last updated 10 September 2026), including the Word document `00_Master_PRD_AI_Review.docx` and the [decision log](../spec/22_Decision_Log.md) |
| Legal pages: privacy, terms, cancellation and refunds, contact  | On the live site under `/legal/`; see [legal pages](#legal-pages) below                                                                                                                                        |
| Where images, videos and fonts came from, and usage rights      | [Media rights](../media-rights/README.md)                                                                                                                                                                      |
| Marketing material: video script, parked promotional video      | [Marketing material](../marketing/README.md)                                                                                                                                                                   |
| Problems found so far, with their business impact               | [Known issues](../known-issues.md)                                                                                                                                                                             |
| What happened when                                              | [Changelog](../history/changelog.md), which opens with a milestone summary                                                                                                                                     |
| The meaning of a term or an ID such as `CHANGE-003`             | [Glossary](../glossary.md)                                                                                                                                                                                     |

### Legal pages

The policy texts are not separate documents: they are pages of the app, written directly in its
code, and anyone can read them on the live site without signing in. Changing their wording is a code
change, made by a developer and deployed like any other change.

| Page                   | Live address                                                                                  | Source file in the repository                                  |
| ---------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Privacy                | [/legal/privacy](https://aireview.digitalhammerr.com/legal/privacy)                           | `apps/web/app/(marketing)/legal/privacy/page.tsx`              |
| Terms                  | [/legal/terms](https://aireview.digitalhammerr.com/legal/terms)                               | `apps/web/app/(marketing)/legal/terms/page.tsx`                |
| Cancellation / Refunds | [/legal/cancellation-refunds](https://aireview.digitalhammerr.com/legal/cancellation-refunds) | `apps/web/app/(marketing)/legal/cancellation-refunds/page.tsx` |
| Contact                | [/legal/contact](https://aireview.digitalhammerr.com/legal/contact)                           | `apps/web/app/(marketing)/legal/contact/page.tsx`              |
| Pricing details        | [/legal/pricing](https://aireview.digitalhammerr.com/legal/pricing)                           | `apps/web/app/(marketing)/legal/pricing/page.tsx`              |

The public contact details shown on these pages are kept in
`apps/web/lib/marketing/public-information.ts`. The legal review of these texts, the refund terms
and the seller's tax details are still [open decisions](../decisions/open-decisions.md).

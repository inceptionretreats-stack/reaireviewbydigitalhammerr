# Product decisions: do not accidentally undo these

The product, website, pricing, workspace and operations decisions that the project owner has
approved. Read this before changing the marketing site, the customer review flow, pricing or plan
wording, the vendor workspace styles, or anything touching live data. Each entry is a deliberate
choice, not an accident waiting to be tidied up: changing one needs the project owner's explicit
approval, even when the change looks like an improvement. File paths are the current locations of
the code that carries each decision.

This list used to be section 2 of `AI_HANDOVER.md`, which now links here. Decisions that changed the
original specification are also recorded formally, with IDs, in
[spec amendments](spec-amendments.md); decisions still waiting for the project owner are in
[open decisions](open-decisions.md).

## Core product rules

- **The customer flow is services first.** The customer picks one or more of the business's
  services, then explicitly asks for a draft. A saved draft is reachable through **Return to
  draft**. There is no star-selection screen, no rating gate and no routing of only happy customers
  to Google. Private feedback stays available to every customer. (Code:
  `apps/web/components/customer/review/`; see
  [customer review flow](../features/customer-review-flow.md).)
- **Never say a review was "submitted" or "posted".** The product only knows that Google was opened.
  An automatic code check (lint rule AC-025, in `eslint.config.mjs`) catches "review submitted"
  wording only; "posted" claims are caught only by some browser-test checks and by review, so check
  your own text. Make no growth or results promises.

## Marketing site

- **User-facing casing is "Ai", not "AI"** (CHANGE-002, D-031). Technical identifiers keep their
  usual spelling, for example `AI_PROVIDER_UNAVAILABLE` and the provider name OpenAI.
- **The hero sentence was supplied by the project owner:** `Review Likhna Ab Easy Hai — AI Hai Na.`
  (`apps/web/components/marketing/home/HomeMarketingPage.tsx`). Do not silently rewrite approved
  copy while doing unrelated work.
- **Keep the look:** the Hinglish hero, readable spacing, strong typography, the blue and
  Google-colour theme, and the robot artwork. The project owner asked for robots, not a girl, in
  illustrative website content.
- **How it works stays at three steps,** with full phones visible, thin bezels and video
  explanations (`apps/web/components/marketing/home/HowItWorksVideos.tsx`). Do not restore the old
  eight-step grid or replace real product screenshots with generic mockups.
- **The business-type strip above How it works is a scrolling list of business categories**
  (`apps/web/components/marketing/home/BusinessAudienceStrip.tsx`), not customer logos or
  testimonials. Never present categories as real, named customers.
- **Visible demo branding uses Digital Hammerr,** a digital marketing company (app and website
  development, SEO or search-engine optimisation, graphic design), never a cafe. Some internal
  seeded identifiers still contain `demo-south-cafe`; renaming identifiers can break references and
  is not a cosmetic edit.
- **Unsupported claims stay removed.** Claims such as `10X in 90 days` and promises about how
  quickly something is done were taken out. Do not reintroduce them without evidence and approval.
- **The shopkeeper story video is not shown,** because its claims and dialogue were never verified
  against the product (`apps/web/components/marketing/parked/ReviewStoryVideo.tsx`; see
  [marketing material](../marketing/README.md)). The component and media are kept. Whether the video
  may be shown is separate from the right to use it, which the project owner confirmed (see
  [media rights](../media-rights/README.md)).

The homepage hero and pricing-card styles live in the shared marketing stylesheet,
`apps/web/components/marketing/site/MarketingSite.module.css`; a change there can affect every
marketing page.

## Plans and pricing

- **Free is 10 Ai drafts in total per business profile. Standard Pro is ₹999 (INR 999) for 12
  calendar months, with 2,000 Ai drafts per paid period** (CHANGE-001, D-030). Only the homepage
  pricing cards and the `/legal/pricing` page read these figures from the platform settings
  (`loadCommercialTerms` in `apps/web/lib/marketing/commercial-terms.ts`); the Terms and the
  Cancellation and refunds pages, and some workspace and email text, state them as fixed text
  ([known issue 19](../known-issues.md)). Do not bring back unlimited Pro, and do not describe the
  allowance as verified posted reviews.
- **The original detailed billing block must not appear beneath the homepage pricing cards, and the
  cards must not expand in place.**
- **Each card's `Show more` link goes to `/legal/pricing`**
  (`apps/web/components/marketing/pricing/PricingDetailsLink.tsx`): one page explaining Free and Pro
  together, with a comparison table beneath the plan details and a `Back to pricing` link to
  `/#pricing`. The cards stay the same size. The old `/legal/pricing/free` and `/legal/pricing/pro`
  addresses redirect to it.
- **Footer links show Privacy, Terms, Cancellation / Refunds and Contact without sign-in**
  (`apps/web/lib/marketing/public-information.ts`). The sign-up form's Terms and Privacy links open
  a new tab, so the fields already typed and the tick box are kept
  (`apps/web/components/auth/SignupForm.tsx`).

## Vendor workspace

- **Vendor screens use the scoped navy-sidebar and light-workspace styling**
  (`apps/web/components/dashboard/shell/VendorWorkspace.module.css`); onboarding has its own scoped
  styles (`apps/web/components/onboarding/VendorOnboarding.module.css`). Keep the dashboard cards in
  equal pairs with their bottom actions aligned. The landing page, the customer review page and the
  admin console are not affected by these vendor styles and should not be.
- **Keep all 11 working navigation links** (`apps/web/components/dashboard/shell/nav-items.ts`);
  placeholder entries for unbuilt screens stay hidden. Setup progress reflects all five real
  onboarding steps, including a truthful publication status. Design detail:
  [vendor UI redesign](../design/vendor-ui-redesign.md).

## Operations

- **Email sender-domain (DNS) verification was paused by the project owner.** DNS settings are the
  domain's internet address settings. Do not resume Cloudflare or DNS changes without permission
  (see [open decisions](open-decisions.md#email-sender-domain)).
- **Do not restore the accounts removed in the 23 September 2026 production reset,** and do not run
  the demo seed against production (see the
  [fresh-start reset record](../history/2026-09-23-fresh-start-reset.md)).
- **Production payments deliberately use Razorpay test mode** as of 24 September 2026, by the
  project owner's choice. It is not a defect; switching to live payments is an
  [open decision](open-decisions.md#payments-mode).

# Product Scope and Roadmap

## Product statement
AI Review by Digital Hammerr helps a real customer move from a QR scan to a review-writing draft with very low friction, then lets the customer edit/copy it and continue to the business's actual Google review page. The same product gives the business a configurable trust/link page, dynamic QR codes, a simple review-request contact list, private feedback and funnel analytics.

## V1 goals
1. A business can register and be live in under 5 minutes.
2. A customer can reach a usable review draft in 2 taps from a QR scan.
3. No customer login, app install or survey is required.
4. The business can change its Google link, profile links and AI context without reprinting the QR.
5. Digital Hammerr can administer 10,000+ independent tenants from one super-admin panel.
6. Analytics must track the full in-product funnel: scan -> page -> generate -> regenerate/edit -> copy -> Google open.
7. The system must never label a review as "submitted" unless an external source can reliably confirm submission.

## V1 functional modules
- Authentication and business account creation.
- Assisted account creation by Digital Hammerr admin.
- Business onboarding wizard.
- Business profile/trust page.
- Section visibility and drag/drop ordering.
- AI Review landing page.
- AI review generation and regeneration.
- Customer edit and copy flow.
- Mandatory genuine-experience confirmation before copy.
- Google/external review redirection.
- Private feedback form and inbox.
- Business AI context and review modes.
- Dynamic QR creation, labels and source attribution.
- QR download for standee production.
- Simple customer contact list for manual review requests.
- Message template variables and copy/open-WhatsApp actions.
- Analytics dashboard and funnel.
- Custom domain/subdomain onboarding.
- Free quota and ₹999/year subscription.
- Razorpay payment/subscription events.
- Digital Hammerr super-admin.
- Audit logs, abuse/rate-limit controls and support flags.

## Explicit non-goals for V1
- Google Business Profile API connection.
- Reading Google reviews into the app.
- Posting business replies to Google.
- Automatic WhatsApp, SMS or email campaigns.
- Full CRM pipeline/deals.
- Multi-location parent-child accounts.
- Employee-specific review campaigns.
- Native iOS/Android apps.
- Review scraping.
- Incentive/reward programs for reviews.
- "Only happy customers go to Google" flows.
- Forced SEO keyword stuffing into customer reviews.
- Automatic review submission.
- White-label reseller portal.

## Phase 1.1 after launch
- AI analytics summaries.
- QR standee order workflow.
- More profile themes.
- CSV customer import if demanded by usage.
- Optional one-line customer context input if policy/quality data shows it is required.

## Phase 2
- Google Business Profile integration for authorized businesses.
- Review monitoring.
- AI-assisted merchant replies.
- Multi-location support.
- Review widgets for business websites.
- White-label agency/reseller system.
- Additional languages.
- International plans/currencies.

## Success metrics
- Signup -> onboarding completion >= 60%.
- Onboarding -> first QR download >= 70%.
- QR landing -> AI generation >= 60%.
- AI generation -> copy >= 60%.
- Copy -> external review-page open >= 80%.
- Free -> paid conversion target: establish baseline first 60 days, then optimize.
- Monthly platform availability target: 99.9% after stable launch.
- AI generation p95 target: < 4 seconds under normal load.
- Public page p75 LCP target: < 2.5 seconds on Indian 4G conditions.

## Product change control
Any change to price, free quota, the no-question customer flow, plan structure, custom-domain inclusion, WhatsApp API exclusion, or Google API exclusion is a product-scope change and must update the Decision Log before coding.

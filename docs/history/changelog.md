# Changelog

Dated notes on releases, live-data changes and verification, newest first. Most entries were
carried over from the dated update notes at the top of the former long `AI_HANDOVER.md`, its
mobile-responsive section and its record of the original 18 September handover; they are lightly
edited for readability, with facts unchanged. Each entry describes the state **on that date**:
deployments named here may since have been replaced, counts are snapshots, and file paths are
quoted as they were then (see the [2026-09-24 restructure](2026-09-24-repository-restructure.md)
for the old → new path map). Entries on the same day are in the order the handover recorded them
where that order is known.

## Milestones at a glance

A plain summary of the project's timeline so far. The detailed entries below start on 18 September;
earlier milestones are recorded in the documents linked here.

| Date        | Milestone                                                                                                                                                                                    | Where it is recorded                                                                                                                          |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 29 Aug 2026 | The product specification was frozen and development began                                                                                                                                   | [Spec pack](../spec/README_FIRST.md)                                                                                                          |
| 10 Sep 2026 | Pro capped at 2,000 Ai drafts a year; the product writes "Ai" rather than "AI"                                                                                                               | [CHANGE-001 and CHANGE-002](../decisions/spec-amendments.md#approved-product-changes)                                                         |
| 11 Sep 2026 | Hinglish became the default draft language; an admin console, editable Ai writing rules and prices, and self-service Razorpay payment were approved                                          | [CHANGE-003 and CHANGE-004](../decisions/spec-amendments.md#approved-product-changes)                                                         |
| 12 Sep 2026 | First production deployment, on Vercel                                                                                                                                                       | [Vercel runbook](2026-09-17-vercel-deploy-runbook.md) (historical)                                                                            |
| 16 Sep 2026 | Admin two-step sign-in switched off in production at the project owner's request                                                                                                             | [AMENDMENT-027](../decisions/spec-amendments.md#amendment-027--admin-mfa-is-built-and-mandatory-a-support-viewer-role-12-hour-admin-sessions) |
| 18 Sep 2026 | Original handover; the project owner confirmed commercial rights to the robot artwork and the shopkeeper video                                                                               | [18 September](#18-september-2026), [asset licence audit](../media-rights/asset-license-audit.md)                                             |
| 23 Sep 2026 | Database moved to Supabase; customer flow changed to "services first"; vendor workspace redesigned; all earlier production data removed at the project owner's request; landing-page updates | [23 September](#23-september-2026)                                                                                                            |
| 24 Sep 2026 | Google sign-in for business owners; mobile-responsive pass; shared pricing details page (local change); repository and documentation reorganised                                             | [24 September](#24-september-2026)                                                                                                            |

## 24 September 2026

### Business and reference documentation

A second documentation pass added documents for readers who do not write code and for newcomers: a
[product overview](../product/README.md), a [glossary](../glossary.md) with the ID prefixes cited in
code, and a [decisions](../decisions/README.md) folder that now holds the approved
[product decisions](../decisions/product-decisions.md) (moved out of `AI_HANDOVER.md` section 2) and
the [open decisions](../decisions/open-decisions.md) (moved out of `docs/known-issues.md`). The
image and video provenance records moved from `docs/compliance/` to
[`docs/media-rights/`](../media-rights/README.md); the Vercel deployment runbook moved to
[history](2026-09-17-vercel-deploy-runbook.md); the Supabase cutover evidence was split into its own
[history record](2026-09-23-supabase-cutover.md). Spec amendments gained a status note listing its
superseded entries, and the known issues gained a business-impact line per item.

### Repository restructure

The repository was reorganised without changing product behaviour: verified dead code, unused
media and unused dependencies were removed; `apps/web` was regrouped into route groups and feature
folders by audience and concern; `scripts/` was grouped by purpose and `e2e/` by audience; the
documents under `docs/` were moved into topic folders; and the long `AI_HANDOVER.md` was split into
the topic documents indexed in [`docs/README.md`](../README.md), leaving a short brief for AI agents.
Full record, including every moved path: [2026-09-24 repository restructure](2026-09-24-repository-restructure.md).

### Pricing details page (local source change)

Both the Free and Pro card `Show more` links now lead to the same `/legal/pricing` page. It presents
both plans together, with a side-by-side comparison table below their details. The old
`/legal/pricing/free` and `/legal/pricing/pro` URLs redirect to it. The compact homepage cards still
do not expand inline. This note described the local source change; its deployment was to be
verified separately.

### Mobile-responsive pass

Production deployment `dpl_4RKyhWegJ68r5vMJDkWcfb9g1cBb` became the live deployment for
`aireview.digitalhammerr.com` and `ai-review-dh.vercel.app`. It was built as a production-target
deployment with domain promotion delayed until staging checks passed; Vercel then promoted that
exact build. It did not change the approved customer-controlled review flow or the backend
provider. (The handover does not record whether this came before or after the pricing-page change
above.)

- **Landing page:** compact three-step layout at tablet widths (the old 768px layout stacked three
  oversized phones), a clearer narrow-phone header action, and breakpoints checked from 320px
  through desktop and ultrawide. Chrome decoded and played the instructional and promotional videos;
  media warnings reported by the Codex in-app browser did not reproduce in Chrome.
- **Vendor:** dashboard tables put QR, customer and review-mode labels above their values on narrow
  phones, preventing cramped letter-by-letter labels. Eleven vendor routes and five onboarding steps
  were inspected at 320, 375, 390, 430 and 768px.
- **Customer and auth:** sign-in and sign-up forms use a compact phone layout. Service selection and
  private-feedback submission stay disabled only until hydration finishes, so taps cannot silently
  become native form submissions. Auth forms and private feedback declare native POST, so their
  contents do not land in a GET URL if JavaScript has not started.
- **Admin:** phone navigation opens through a Menu button and closes after navigation, an outside
  tap or Escape. Long stacked-table values wrap inside the activity card instead of overflowing at
  320px. Eight admin routes passed the 320/390/768px width sweep.
- **Validation:** `pnpm build`, `pnpm typecheck` and all 1,620 unit tests passed. The responsive
  browser tests passed across the named surfaces; two legacy admin generation tests needed the new
  `selected_services` request field and then passed against the local deterministic test provider.
  A local `.env` Gemini credential returned 401 during an earlier run. That is not evidence about
  production credentials, which this pass did not exercise; verify live Ai generation separately
  with an authorised, controlled test before calling the provider healthy.

### Google sign-in for vendors

Production deployment `dpl_EkHAWrv5HRgcnHcpii6n9zRwoQWa` was READY and promoted to
`aireview.digitalhammerr.com` and `ai-review-dh.vercel.app`.

- The older Vercel alias redirects only `/login`, `/signup` and `/signup/google` to the custom
  domain, which is the authorised Google JavaScript origin. QR and customer routes stay on their
  original host.
- The Google OAuth client is in the Inception Google Cloud project `ai-review-509604`; application
  data stays in the Digital Hammerr Supabase Free project `vouqzekpujgzsplhqqor`.
- Migration `0008_bent_darkstar` was applied there (nine journal entries in total).
  `google_identities` has row-level security enabled and no Data API grants.
- New Google vendors must still provide mobile and business details, accept the terms and complete
  the usual onboarding. Existing password vendors must confirm their app password before linking.
  Password and MFA admin login are unchanged.
- Verification: full unit suite 1,620 passed; migration guard, build, focused lint and the Google
  onboarding browser tests passed; live route and challenge checks passed. The real Google account
  chooser opened locally, but browser automation could not select an account, so a real
  token-to-onboarding handoff still needs manual verification. See
  [Google sign-in](../operations/google-sign-in.md).

Migration and deployment counts in older entries below are historical snapshots.

## 23 September 2026

### Landing page: benefits section and category rail

Production deployment `dpl_3FegzB6fTdcYRNR4ecDnAc5fKVtC` was READY and promoted to
`aireview.digitalhammerr.com` and `ai-review-dh.vercel.app`.

- The former four-column "What sets Ai Review apart?" block became a spacious two-column benefits
  section (`ReviewBenefits.tsx` / `.module.css`): truthful feature chips and three
  customer-controlled steps on the left; a real local-shop photograph with the editable illustrative
  draft preview on the right. The photo is an optimised, licensed Pexels image; source and usage
  limits are in the [asset licence audit](../media-rights/asset-license-audit.md). The people pictured
  are not customers or endorsers. Do not restore the AI-looking floating robot concept or
  unsupported review counts or results. The section keeps its `#why-ai-review` anchor, sign-up link,
  How it works link and locally editable example draft.
- The business-category rail became wider and thicker and uses consistent `lucide-react` outline
  icons in brand colours instead of the earlier custom 44-symbol sprite. The hero "Ai" blue, red,
  yellow and green colour cycle is smooth and continuous, and the click response is subdued. Earlier
  notes describing the icon sprite or benefits metrics are superseded.
- Verification: 59 isolated landing, mobile and responsive browser checks, web typecheck, targeted
  ESLint/Prettier and a diff check passed. Local and live desktop/mobile visual checks showed the
  real photo, readable text, no horizontal overflow and a working example editor. Both live aliases
  and the image returned HTTP 200; an immediate deployment error-log query found no errors. No
  backend, production data, environment, plans or QR flow changed.

### Marketing icons and logo colours

Production deployment `dpl_GgZ6rRnqvg3aAn9iPvKGVEPhVukc` was READY and promoted to both
`aireview.digitalhammerr.com` and `ai-review-dh.vercel.app`.

- The business-category marquee gave each of its 48 labels a matching small SVG icon from a local
  44-symbol sprite (`BusinessAudienceIcons.tsx`). The white rail, typography, spacing, colour dots,
  seamless 180-second scroll, hover/focus pause and reduced-motion behaviour were kept. Icons are
  decorative for assistive technology, and both scrolling copies keep the same labels.
- The hero headline's "Ai" and underline cycle automatically through dark readable blue, red, gold
  and green from the brand, keeping the existing click response; reduced-motion and forced-colour
  users see a static readable accent.
- Very light logo-colour tints were added to the review-opportunity panel, the three How it works
  steps and open FAQ answers. No core review flow, pricing, vendor UI or backend behaviour changed.
- Verification: all 31 isolated landing browser tests passed, including marquee seam, pause and
  reduced motion, mobile layout, hero click and the three-step journey; web TypeScript, scoped
  ESLint/Prettier, a diff check and the Vercel production build passed. Live desktop and phone checks
  confirmed the 48 icon instances, the four-colour headline animation, and no horizontal overflow or
  console warnings or errors. Both live aliases returned 200 with the icon sprite; an immediate
  production error-log scan found zero entries. The reference icon treatment was adapted to the
  existing thin white marquee without adding the reference's pill cards. No production data or
  environment settings changed.

(The sprite described here was replaced by `lucide-react` icons in the entry above.)

### Review-opportunity section

Production deployment `dpl_2HW8V1jSLHQmi6nrJGZk6kPKcpYq` was READY and promoted to both live
domains.

- `ReviewOpportunitySection.tsx` / `.module.css` is mounted between the business-category marquee
  and How it works. The owner supplied the heading "Ignoring reviews is like turning customers away
  at your door" and asked for the exact labels **Lost Trust / Lost Sales / Lost Customers**, then for
  matching emoji **💔 / 📉 / 🚶**, which replaced the first line-icon version. The supporting copy
  describes QR scanning, service selection, editing an Ai-assisted draft and customers posting
  themselves on Google. Do not restore the reference design's unrelated ebook, holiday or
  multichannel-marketing offer.
- QA: 6 final section browser tests and 31 existing landing regressions passed, with checks at
  320/390/768/1329/1440px for section order, decorative emoji accessibility, no text clipping or
  overflow, no console errors, and keyboard navigation to How it works. Web TypeScript, scoped
  ESLint/Prettier, a diff check and the production build passed.
- Reference and final desktop/mobile screenshots were compared visually: the rounded-panel
  composition, bold two-line desktop heading, three evenly spaced illustrations, connected arrows,
  label alignment and content density were kept. Intentional differences: the site's navy/pale-blue
  palette, product-specific paragraph, new relevant emoji and vertically stacked mobile rows with
  dashed connectors. Emoji appearance follows the visitor's platform.
- Both live aliases returned 200 with the final labels and emoji; live browser content and console
  and an immediate deployment error scan were clean. No backend, account, plan, provider,
  environment or production-data changes.

### Marketing typography

Production deployment `dpl_5qfseFqCGyYw1nuxusye8tQfWTnS` was READY and promoted to the existing
production domains.

- The owner asked for the exact promotional-video heading "Stop Losing Customers Because of Bad or
  Missing Reviews", styled from their screenshot in the existing navy/blue palette.
  `PromoVideoSection` uses locally hosted Inter ExtraBold (800), a blue "Reviews" accent and
  decorative curved underline and strokes; the video, controls and four-colour border are unchanged.
- Pricing amounts use locally hosted Inter SemiBold (600), lining/tabular numerals and a smaller
  rupee symbol. ₹0, ₹999 / year, the allowances and all billing terms were unchanged. Both font files
  and their SIL OFL licence already existed in `apps/web/assets/fonts`; no font dependency, external
  font service, global font replacement or backend change was introduced.
- QA: 19 isolated promo and pricing browser tests passed across 320–1622px widths, including the
  reference-width (1218px) headline, mobile wrapping, price/currency/year bounds, paired card
  alignment, sign-up navigation and video play/pause. Web TypeScript, scoped ESLint/Prettier and the
  Vercel production build passed. The supplied references and final screenshots were compared for
  copy, type weight and shapes, composition, palette, underline geometry and mobile fit. Intentional
  differences: brand blue instead of the reference green, Inter instead of the reference font, and a
  headline constrained to the site's responsive width.
- No production records or live draft allowance changed. This replaced only the old
  promotional-video heading; the approved home-hero copy stays.

### Customer QR flow: services first

Production deployment `dpl_4jJ6uDyirhy1NfcETdXQ28Kafiky` was READY and promoted to both
`aireview.digitalhammerr.com` and `ai-review-dh.vercel.app`.

- Every scan, revisit and reload starts on the services screen with nothing preselected, including
  anonymous sessions that already have a draft. Customers choose one or more of the business's saved
  services, then explicitly create an editable draft. A saved draft is reachable only through
  "Return to draft"; recovery, scanning and selecting do not consume another draft. This superseded
  earlier behaviour of generating automatically or opening a saved draft on arrival.
- Existing accounts and businesses were new, legitimate data and were preserved; no migration, seed,
  reset, provider switch or paid service was used.
- Service labels come from `ai_business_contexts.services`, maintained in the vendor's Ai review
  settings. Only labels reach public pages; internal context stays on the server. With no services
  configured, customers can explicitly create a general draft.
- `ReviewFlow.tsx`, `ServicePicker.tsx` and `CustomerReview.module.css` implement mobile-first
  multi-selection, progress, changing services, keeping an existing draft on cancel or failure, and
  an editable result. `selected_services` is validated on the server against the resolved business
  before rate limiting, quota or provider calls. Unknown or missing choices return 422 for businesses
  with services. Limits: 30 choices, 80 characters per label, 600 characters joined.
- Selected-service prompts exclude unrelated business descriptions, categories, modes and keywords.
  Using a service is not treated as evidence of satisfaction or results. Customers still confirm a
  genuine experience before copying, then decide what to paste and post on Google. Private feedback
  and the direct Google option remain. Editing or regenerating clears the confirmation.
- QR and slug review routes reuse the anonymous session's latest stored draft. Selection metadata is
  kept in `sessionStorage`, bound to the generation ID; no review text or confirmation is stored
  there. If storage is unavailable or the services changed, the old draft stays usable but a new one
  requires choosing again. Unsaved text edits do not survive a full page reload.
- Verification: 1,587 unit tests in 98 files; 30 isolated browser tests; web TypeScript, targeted
  ESLint and the Vercel production build passed. Browser checks covered 320, 390 and 1440px, keyboard
  selection, retries, changed services, restoration, confirmation and the clipboard fallback. Live QR
  pages on both aliases returned 200 with the real service list; live multi-select worked and the
  console was clean. An immediate deployment error-log scan returned zero errors. End-to-end
  generation used the isolated test provider, not live Gemini, so no live allowance was spent.
- Visual verification compared the generated two-state concept with browser captures: white panel
  on a pale-blue page, four-colour top border, horizontal identity, three-step rail, selectable
  service tiles and action hierarchy were kept. Very small screens use one column to avoid broken
  words. Real vendor labels and the 1,200-character editor limit replace example content; the
  existing "New review" and explicit "Change services" labels stay. A redundant copy icon was removed
  to keep the mobile action legible.
- Follow-up verification: 32 isolated customer-flow and visual browser tests passed, including a
  saved-draft refresh, a same-tab rescan and a new tab sharing the anonymous cookie at 390px. Fresh
  selections replace old services, and entering or recovering makes no generation request and does
  not change quota. Web TypeScript, scoped ESLint and the production build passed. The protected
  candidate and both live QR aliases returned 200 with the picker; live multi-selection, reload and
  the mobile screenshot passed with no console warnings or errors. This follow-up did not generate a
  live draft or consume live allowance.

### Fresh-start reset of production data

At the owner's explicit request, all nine previous app accounts (including both admins), seven
businesses, five QR codes, customer records, drafts, activity and audit history, sessions and reset
tokens, subscriptions and seven application payment records were removed. Do not restore the old
test accounts or run the demo seed against production. After the reset the app had no
login-capable accounts or admins, and the owner's email was free for a new sign-up. Any later
legitimate sign-up is new data and must not be reset automatically.

Only two fresh internal rows were created: one disabled **and** soft-deleted technical identity that
cannot log in, and one stock active Ai prompt (prompt authorship requires a user foreign key).
Neither reuses an old user ID or login. Database structure, all row-level security settings, the
eight migrations, the deployed website and the server configuration were preserved. The owner's new
sign-up is a normal business-owner account; there is no first-user admin promotion, and admin
access must be configured explicitly. Full scope, recovery and verification limits:
[2026-09-23 fresh-start reset](2026-09-23-fresh-start-reset.md).

### Vendor UI redesign

The navy-sidebar / light-workspace vendor redesign and simpler onboarding were promoted to
`aireview.digitalhammerr.com` as production deployment `dpl_6UUKfgDMrXF19uGGc2bSCf9xrVPC` (READY),
keeping the completed Supabase cutover. Dashboard metric cards are equal-sized, the public-page and
subscription panels and their actions line up, navigation is grouped, and mobile layouts stack
without horizontal overflow. Detailed Ai and QR guidance is available on demand. The release kept
the Supabase backend, custom authentication, plans and core review flow; the UI work changed no
production environment variables or database records. Design decisions and verification scope:
[vendor UI redesign](../design/vendor-ui-redesign.md).

Verification: 1,534 unit tests in 94 files, 11 isolated browser tests, web TypeScript,
application/package/e2e ESLint and the production build passed. After promotion, `/`, `/login` and
`/signup` returned 200; `/app` and `/onboarding/business` redirected to `/login`; unauthenticated
`/api/v1/business` returned 401. Authenticated UI tests used synthetic local data, not a live
merchant account. These public smoke checks are not live verification of payments, email, the Ai
provider or authenticated end-to-end flows.

(The handover does not record whether this release came before or after the fresh-start reset.)

### Database cutover to Supabase

The Supabase-backed production deployment `dpl_8VTibmWMkzGMBfXBdkjMHUHtxGnU` was promoted at about
09:57 UTC, and all ten public HTTP checks passed afterwards (the candidate had also passed them
before promotion). The Next.js application and API stayed on the existing Inception Vercel project;
PostgreSQL moved to the **Ai Review** Supabase Free project `vouqzekpujgzsplhqqor` in the **Digital
Hammerr** organisation `fmqzifenquuoysefzfui`, Mumbai (`ap-south-1`). No paid upgrade was made. Full
backup, migration, deployment and verification evidence:
[2026-09-23 Supabase cutover](2026-09-23-supabase-cutover.md); the current runbook is
[database on Supabase](../operations/database-supabase.md).

- The final source snapshot held nine accounts and five businesses. Public-table row hashes and
  sequence states were preserved, including user, password and session material. (These records
  were later removed by the fresh-start reset above.)
- The target had 38 public tables including partitions and `maintenance_jobs`, plus the private
  Drizzle journal: 39 tables and eight verified migrations. These are cutover counts, not permanent
  ones.
- Authentication stayed the application's own PostgreSQL-backed system (`public.users`, not
  Supabase `auth.users`). The Data API is disabled; all 39 tables have row-level security and the
  API roles have no table, column or sequence access.
- The original Neon database was closed to application connections. Do not reopen it, rerun the
  refresh or restore, or promote an old Neon-backed deployment as a rollback once Supabase has
  accepted writes; stop writes and reconcile through a reviewed recovery plan first.
- Only six production database variables changed: `DATABASE_URL`, `DIRECT_DATABASE_URL`,
  `DATABASE_SSL`, `DATABASE_SSL_ROOT_CERT`, `DATABASE_POOL_MIN` and `DATABASE_POOL_MAX`.
  Non-database production settings and development/preview settings were preserved; the
  non-production `DATABASE_URL` still pointed at the fenced Neon database, pending a separate
  decision.
- Five existing QR codes and five primary slugs passed read-only resolver checks. The runtime
  adapter passed verified TLS and a temporary-table write/read/rollback through the transaction
  pooler (port 6543). The full offline suite passed 1,526 tests in 93 files. The public QR visits
  created normal anonymous-session and scan records on Supabase, so the target had accepted writes
  and a direct rollback to Neon became unsafe.
- These checks did **not** create a merchant account, sign in an existing user, generate an Ai
  review, charge or refund a payment, or verify email delivery. Email-domain/DNS work remained
  paused. A migrated database is not proof that every integration is launch-ready.

Other product notes from the handover at this point were dated working notes from 18 September. The
handover was an internal working document, not a launch-readiness certificate or a public legal
policy.

## 18 September 2026

### Original handover

- Git snapshot observed: branch `main`, commit `4c370b8` ("Release latest website, review video, and
  dashboard updates").
- The owner explicitly confirmed commercial rights to the existing robot artwork and the shopkeeper
  promotional video, including its voice and music. This is the owner's confirmation, not
  independent proof; see the [asset licence audit](../media-rights/asset-license-audit.md).
- Local read-only checks found Free = 10 and Pro = 2,000 drafts stored in platform settings, the
  price at the application default of 99,900 paise, and no local seller GSTIN or state, so no GST
  split was configured. These did not verify live production settings, tax registration or
  applicable rates.

### Verification results recorded in the original handover

- Production web build, typecheck, targeted lint/format and `git diff --check` passed for the latest
  UI and public-page work.
- **16 pricing layout and navigation tests passed**, covering several desktop widths down to 320px.
- **22 public-information tests passed in that day's layout**, covering signed-out policy access,
  footer links, the sign-up form keeping its values after opening legal links, the then-separate
  Free and Pro pages, Back and Compare links, unchanged card dimensions, and layout and console
  checks at 1280/390/320px. The later shared pricing page needs its own verification.
- Earlier the same day, **8 focused landing tests** and **63 isolated quota/generation unit tests**
  passed. The 63 used in-memory quota and stub providers and do not cover the open payment, renewal,
  refund and persistence issues in [known issues](../known-issues.md).
- During final QA the web server and local PostgreSQL had stopped; they were restarted on the
  existing database without seeding or migrating, and the initial connection-refused and timeout
  runs were rerun successfully.
- No production deployment, live payment or refund, sign-up submission, outgoing support email or
  Google posting was performed during that UI verification. Browser evidence was saved outside the
  repository in the machine's temporary folder (notably
  `ai-review-public-information-final-20260918`); it is disposable, not a project dependency.

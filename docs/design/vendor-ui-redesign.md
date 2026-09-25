# Vendor workspace and onboarding redesign

The design rules and tokens for the business owner's workspace ("vendor workspace") and the
onboarding steps, plus the record of the 23 September 2026 release that introduced them. Read the
"Implemented experience" and "Design tokens and responsive rules" sections before changing vendor
or onboarding styles; the approved decisions they carry are also listed in
[product decisions](../decisions/product-decisions.md#vendor-workspace).

> **Partly historical.** The design rules and tokens describe the current code. The release status,
> fidelity ledger, visual evidence, verification results and isolation notes are a dated QA record
> of 23 September 2026: counts, deployment IDs and helper files named there are as they were that
> day. "Merchant" in this document means a business owner.

Verified: 23 September 2026.

## Scope and release status

This is a presentation and usability pass on the authenticated vendor workspace and the five-step business onboarding flow. It does not replace the application's authentication, tenant boundaries, database, billing, review-generation rules, or customer-controlled posting flow. The public marketing design is outside this change.

Deployment `dpl_6UUKfgDMrXF19uGGc2bSCf9xrVPC` was promoted to **READY production**. A subsequent Vercel inspection of `https://aireview.digitalhammerr.com` resolved to that exact deployment. The Next.js 16.3.3 build completed in 32 seconds. Its source was HEAD `0de3581e886b4e8a25c6610b660ab71c84c90673` plus the preserved uncommitted working-tree changes; HEAD alone is therefore not a complete source snapshot of the deployment.

The post-promotion smoke was unauthenticated: `/`, `/login`, and `/signup` returned 200; `/app` and `/onboarding/business` redirected to `/login` with 307; `/api/v1/business` returned 401. A scoped 15-minute runtime-error query completed successfully with zero structured records. This is a bounded observation, not proof of all production behavior. **Authenticated merchant UI verification was local and synthetic, not performed on a live merchant account.**

## Implemented experience

- A navy workspace sidebar, white top bar, pale work surface, restrained white cards, clear typography, and a thin four-colour brand edge replace the more decorative vendor styling.
- Eleven functioning navigation destinations remain available, grouped under **Workspace**, **Review setup**, **Customer activity**, and **Account**. Unbuilt Custom Domain and Support entries are omitted from the rendered menu instead of presenting disabled “Soon” dead ends. Their underlying planned-route metadata is retained.
- The overview pairs the real enabled-QR and draft-allowance metrics, then pairs the public-page and subscription cards. Each pair has equal desktop dimensions. Open page, Copy link, and the plan action align to one desktop baseline.
- Mobile uses a compact menu, stacked cards, wrapping content, and responsive customer/QR tables. Escape closes the menu and restores focus; selecting a destination closes it. No shell-ancestor transform is introduced, so fixed dialogs remain viewport-relative.
- Shared vendor fields use readable 16px text and at least 44px control heights. Primary, secondary, and destructive actions remain distinguishable; destructive buttons have white text with a measured contrast ratio of at least 4.5:1.
- The Ai settings screen has the concise heading **Ai review settings**. Its seven-item explanation is preserved in a native, initially closed “How your details are used” disclosure. QR instructions similarly retain all four explanations under “How your QR codes work”. Both work with Enter and Space.
- Onboarding has its own quiet setup shell: a desktop introduction sidebar, central form panel, named five-step progress rail, clear current/completed states, and stable Back / Save & exit / Continue actions. On narrow screens the introduction collapses to the brand header and the actions stack. Existing labels, form values, validation, save handlers, publish conditions, and resume routing are retained.

Primary implementation surfaces:

- `apps/web/components/dashboard/shell/VendorWorkspace.module.css`
- `apps/web/components/dashboard/shell/DashboardNav.tsx`
- Dashboard overview, metric, public-page, subscription, reporting, Ai-help, and QR-help components
- `apps/web/components/onboarding/VendorOnboarding.module.css`
- `apps/web/components/onboarding/WizardShell.tsx`
- `apps/web/app/(vendor)/onboarding/layout.tsx`

## Design tokens and responsive rules

The styles are scoped to the vendor or onboarding shell rather than globally recolouring marketing or customer pages.

| Element                     | Implemented value / rule                                                                                       |
| --------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Vendor sidebar              | `#12233b`; 232px desktop column from 1024px                                                                    |
| Work surface / cards        | `#f4f6fa` / `#ffffff`                                                                                          |
| Primary / muted vendor text | `#14243b` / `#566781`                                                                                          |
| Card border                 | `#dee5ee`; 1px; 12px corner radius; very light shadow                                                          |
| Primary action / hover      | `#1967d2` / `#1558b5`                                                                                          |
| Brand edge                  | Blue `#4285f4`, red `#ea4335`, yellow `#fbbc05`, green `#34a853`; 4px vendor / 3px onboarding                  |
| Vendor headings             | H1 `clamp(24px, 2.3vw, 32px)`, weight 700; H2 18px, or 17px on small phones                                    |
| Vendor buttons / fields     | 8px radius; buttons at least 44px; fields 16px; textarea at least 112px                                        |
| Overview spacing            | 22px desktop gaps; paired public/plan padding 24px; 16px small-screen content gutters; small-card padding 20px |
| Overview pairing            | Two columns from 640px; metric minimum 150px and public/plan minimum 320px; content may grow                   |
| Mobile metric rows          | Equal-height automatic grid rows; minimum 128px below 640px                                                    |
| Onboarding panel            | 930px maximum workspace width; 280px desktop story column; 12px panel radius; 32px desktop panel padding       |
| Onboarding type / actions   | 16px field text, fields at least 46px; action buttons 46px desktop / 48px at widths up to 600px                |
| Onboarding mobile           | Single-column shell below 1024px; 16px main gutters and stacked actions up to 600px                            |
| Motion / focus              | Short colour transitions only; reduced-motion disables vendor transitions; visible keyboard-focus outlines     |

## Concept-to-render fidelity ledger

The accepted dashboard concept is a visual direction, not a source of business facts. It was compared against an actual browser render, not against implementation code alone.

| Concept feature                                    | Rendered evidence and disposition                                                                                                                                                                                                                         |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Navy grouped navigation with a blue current item   | Matched in the rendered desktop sidebar. All eleven real destinations are retained; four section labels provide the same hierarchy.                                                                                                                       |
| Light workspace, white header, thin brand strip    | Matched. The strip uses the application's four brand colours; heavy glow, hover lift, and decorative heading pseudo-elements are removed within this surface.                                                                                             |
| Business heading, live status, two leading actions | Matched in hierarchy and placement. The heading and status come from the current tenant, not hard-coded concept text.                                                                                                                                     |
| Two icon-led metric cards                          | Matched with restrained circular icons and equal geometry. At 1487px the cards measured **584.5 × 150px** each. Real fixture data showed two enabled QR sources rather than the concept's illustrative one.                                               |
| Public-page and subscription cards side by side    | Matched as equal desktop columns. Final native-size render measured **584.5 × 320px** for each card. Content remains selectable, readable, and responsive.                                                                                                |
| Aligned Open page / Copy link / Upgrade actions    | Matched after replacing the public-action row with equal grid columns and removing the empty Copy wrapper gap. At the final viewport all three tops were **y = 631.390625px** and all three heights were **44px**.                                        |
| Public address and plan information                | Same information hierarchy, but intentionally uses the real canonical address and stored subscription state/price/allowances. The concept's illustrative `/b/...` URL is not substituted for the application's real route.                                |
| Bottom reporting panel                             | Retains the functional analytics link and accurate reporting explanation. The concept's “Reporting is not available yet” wording is not copied where it would misrepresent working analytics. No fabricated trends or review-submission counts are added. |
| Clean form system and mobile adaptation            | The onboarding form extends the same restrained visual language. All five named steps remain available; mobile reflows instead of scaling down the desktop image. 16px inputs and complete labels were checked at 320px and 390px.                        |

Intentional deviations include the working sign-out button, actual tenant-specific values and status notes, the canonical public URL, the real plan action, explanatory helper copy, and customer-control/compliance wording. Concept-only duplicate labels, invented metrics, and unavailable navigation are not reproduced. Typography and column sizing are implemented as responsive CSS rather than a pixel-identical raster replica; generated concept text and icon pixels are not shipped as interface assets.

## Visual comparison and evidence

Reference concept, native dimensions **1487 × 1058px**: a generated image kept on the project
owner's computer (in the Codex generated-images folder), not in the repository.

Final browser evidence names and dimensions:

| Screenshot                                          | Viewport / capture                                                  |
| --------------------------------------------------- | ------------------------------------------------------------------- |
| `vendor-dashboard-final-1487x1058.png`              | Exact 1487 × 1058px desktop viewport capture                        |
| `vendor-dashboard-final-390x844.png`                | Exact 390 × 844px mobile viewport capture                           |
| `vendor-dashboard-final-390-full.png`               | 390px-wide full-page companion for content below the first viewport |
| `vendor-onboarding-business-1440.png`               | 1440 × 1000px viewport, full-page capture                           |
| `vendor-onboarding-business-390.png`                | 390 × 844px viewport, full-page capture                             |
| `vendor-ai-settings-1440.png`, `vendor-qr-1440.png` | 1440 × 1000px viewport, full-page captures                          |

The final desktop viewport was deliberately set to the concept's native dimensions before comparing both files with `view_image`. Mobile viewport and full-page images were inspected separately to check reflow, not stretched to imitate the desktop reference. Browser DOM measurements independently checked card dimensions, action baselines, and document overflow. Captures waited for actual visible streamed content and font readiness: merely counting hidden Suspense nodes is not sufficient evidence of a rendered dashboard.

The synthetic QA stack was stopped successfully after verification; its browser tab was closed and viewport reset. Automatic directory cleanup was blocked by command-execution policy, so the synthetic database and screenshot artifacts remain in the run's OS-temp directory. No deletion was performed or bypass attempted. Screenshots are verification-only artifacts, **not deployed or committed product assets**; their evidence names and measured results above remain the durable record.

## Verification results

_Note, 24 September 2026:_ `eslint.config.mjs` now ignores `tmp/`, `.agents/` and `.dev/`, and the
local `tmp/` folder has since been removed, so the full-repository `pnpm lint` row below describes
that day only. `pnpm lint` is the same check CI runs.

| Check                                                        | Result                                                                                                                                                                            |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Full unit suite, `pnpm test`                                 | **94 files, 1,534 tests passed**                                                                                                                                                  |
| Vendor browser suite, `e2e/vendor/dashboard.spec.ts`, Chrome | **11 tests passed** after the Ai/QR disclosures and destructive-colour changes                                                                                                    |
| Web TypeScript check                                         | Passed                                                                                                                                                                            |
| Scoped ESLint, `apps/web packages e2e`                       | Passed                                                                                                                                                                            |
| `git diff --check`                                           | Passed                                                                                                                                                                            |
| Final native-size geometry probe                             | Passed at 1487 × 1058 and 390 × 844; no overflow or page errors                                                                                                                   |
| Full repository `pnpm lint`                                  | Not clean: scans unrelated ignored `tmp` operational scripts and installed `.agents` skill examples, producing Node-global/rule errors. This is not reported as a full-lint pass. |

Post-promotion production smoke passed for the public pages and anonymous access boundaries recorded above. No live authenticated merchant flow was exercised.

Browser coverage:

- All eleven vendor destinations render their own content and exactly one active navigation item. Existing no-fabricated-submission/no-requested-rating checks remain.
- Dashboard, QR, Settings, and Customers have no horizontal document overflow at **320 × 740, 390 × 844, 768 × 1024, 1024 × 900, and 1440 × 1000**.
- Metric/public-plan pair dimensions align at 1024px and 1440px. The final post-padding/action-baseline probe additionally verified the exact 1487 × 1058px concept viewport.
- Mobile menu opening, destination selection, Escape dismissal, and returned button focus work. The formerly ambiguous QR link assertion is now scoped to Dashboard sections navigation.
- Customer table/search and Add customer dialog geometry/focus/Escape were exercised at 320, 390, 768, and 1440px without saving a contact.
- All five onboarding routes were checked at **320 × 844, 390 × 844, and 1440 × 1000**: five labels, one current step, unclipped rail, readable controls, safe Back navigation, and the published fixture's correct resume destination.
- Ai/QR disclosures are initially closed, preserve seven/four help items, open with Enter, and close with Space. Reset confirmation text is white on its destructive background with at least 4.5:1 measured contrast; the dialog was cancelled, not applied.
- Existing QR SVG/PNG branding and decoding, reachable navigation links, and session-ending sign-out checks passed.

These checks do not constitute a new live payment, email, review-generation-provider, or real merchant onboarding test. Other browser engines, real-device keyboards, and every possible tenant/data combination remain outside this bounded visual regression pass.

## Isolation and reproducibility

Browser QA used `http://127.0.0.1:3100` with a fresh synthetic local PostgreSQL cluster at `127.0.0.1:55432`, database `ai_review_vendor_ui`. Migration and seeding were confined to that exact local identity. Child-process overrides blocked production `.env` loading and external Node network destinations; external provider credentials were blank or synthetic. No tunnel or worker was started.

Only synthetic sessions and test-fixture activity were created. **No live merchant account, review, business configuration, or cloud database was changed by this QA run.** The optional screenshot helper writes only when `VENDOR_UI_ARTIFACT_DIR` is explicitly supplied; the local harness points it outside the repository.

Maintained regression files:

- `e2e/vendor/dashboard.spec.ts`
- `apps/web/components/dashboard/shell/__tests__/nav-items.test.ts`

Local operational helpers under `tmp/vendor-ui-*` remained ignored convenience scripts because automatic cleanup was blocked (they were deleted when the local `tmp/` folder was cleared on 24 September 2026). They are not deployed application code or deployment prerequisites. Do not run the unguarded seed/migration/e2e commands against a production-configured `.env` to reproduce this visual QA. Use an independently verified disposable local database and process-only overrides. No credentials are included in this document.

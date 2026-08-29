# UI/UX Design System Brief

## Brand
Product name: **AI Review by Digital Hammerr**.
The design should feel modern, trustworthy, fast and business-grade - not childish, gimmicky or overloaded with AI/robot graphics.

## Two UI worlds
### Customer/public
- Mobile-first.
- One primary task at a time.
- Large tap targets.
- Minimal navigation.
- Business branding visible but product mechanics simple.
- Generate -> edit/regenerate -> confirm -> copy -> Google.

### Business/admin
- Desktop-first but responsive.
- Clear sidebar navigation.
- KPI cards + compact tables/charts.
- Live mobile preview for profile settings.

## Public review screen hierarchy
1. Business logo + name.
2. Short line: "AI can help you write your review."
3. Primary CTA: `Generate My Review`.
4. Secondary text link/button: `Send Private Feedback`.
5. After generation: large editable textarea.
6. Secondary `Regenerate`.
7. Required confirmation checkbox.
8. Primary `Copy Review`.
9. After copy: primary `Continue to Google`.

## Do not show
- Star chooser before Google.
- "Get us 5 stars" language.
- Fake counters like "98% customers love us" unless backed by real data.
- Mandatory keyword list.
- Long surveys.
- Forced app login.

## Business dashboard nav
Dashboard / AI Review / Review Modes / QR Codes / Business Profile / Customers / Review Requests / Private Feedback / Analytics / Custom Domain / Subscription / Settings / Support.

## Components
- Buttons: primary, secondary, destructive, text.
- Inputs: text, phone, URL, textarea, tag input, select, toggle.
- Cards: KPI, setup progress, quota, subscription.
- Table with responsive stacked mobile mode.
- Drawer/modal for small CRUD.
- Toast + inline error.
- Empty states with single clear CTA.
- Status badges: Free/Pro, Active/Pending/Disabled, New/Read/Archived.

## Accessibility
- WCAG 2.2 AA target.
- Minimum 44x44 touch target on primary mobile controls.
- Proper labels/errors; never placeholder-only labels.
- Keyboard navigation and visible focus.
- Charts must provide text/table equivalent.
- Do not rely on color alone for statuses.

## Design deliverables before frontend build
1. Sitemap.
2. Low-fidelity flow prototype.
3. Component library.
4. Customer review mobile screens for all states.
5. Business dashboard desktop + responsive variants.
6. Onboarding wizard.
7. Profile editor with live preview.
8. QR manager.
9. Analytics dashboard.
10. Custom domain setup states.
11. Subscription/free quota states.
12. Super-admin screens.

## UX copy principles
- Simple English.
- Prefer "Generate My Review" over technical AI terms.
- Say "Google review page opened", never "review submitted" in business analytics.
- Explain custom-domain DNS in step-by-step plain language.
- Explain AI context as optional context, not guaranteed words.

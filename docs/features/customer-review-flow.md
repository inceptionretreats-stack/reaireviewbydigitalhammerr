# Customer review flow

This document describes what a customer experiences after scanning a business's QR code or opening
its review link, and exactly what the code does at each step: resolving the business, choosing
services, asking for an Ai draft, recovering a saved draft, confirming, copying and opening Google,
or leaving private feedback instead. It also lists what is stored where. Read it before changing
anything under `components/customer/review/`, the customer routes or the public API.

## Ground rules

These are product rules, enforced in code and tests; do not weaken them.

- The customer needs no account and no app. Google may ask them to sign in to post.
- There is **no star rating, no sentiment question and no routing** based on how the visit went.
  Private feedback is offered to everyone, equally.
- The product never posts a review and cannot know whether one was posted. The furthest it observes
  is that the Google review page was opened. No text may say a review was "submitted" or "posted".
- The customer must **confirm the draft reflects their genuine experience** before copying.
- The **"Write my own review"** link to Google stays available on the services screen whatever
  happens to Ai drafting (quota exhausted, provider down, Ai switched off by an admin).

## Entry points

| URL              | Page file                                        | Notes                                                                               |
| ---------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `/r/{code}`      | `apps/web/app/(customer)/r/[code]/page.tsx`      | Printed QR. Records `qr_scan` and `review_page_view`.                               |
| `/{slug}/review` | `apps/web/app/(customer)/[slug]/review/page.tsx` | Same flow by link; tracked request links redirect here. Records no page-view event. |
| `/r/req/{token}` | `apps/web/app/(customer)/r/req/[token]/route.ts` | Records the click, then redirects to `/{slug}/review`.                              |

Both pages render the same client component, `ReviewFlow`. `/{slug}` (the public business page) is
different: its "Review us" button opens Google directly, with no Ai draft.

## The flow, step by step

```text
Scan QR  ->  /r/{code}
  1. Resolve QR -> business (server). Disabled QR or inactive business -> "not available" page.
  2. Read the dh_anon cookie -> anonymous session for this business; record qr_scan + review_page_view.
  3. Load the business's service labels and this session's latest draft (if any).
  4. Services screen: nothing preselected. "Create my draft" | "Return to draft" | "Write my own review".
  5. Create my draft -> POST /api/v1/public/review/generate -> editable draft.
  6. Customer edits, or taps "New review" (another draft; confirmation cleared).
  7. Ticks "I confirm this draft reflects my genuine experience."
  8. "Copy & open Google": clipboard write + Google review page in a new tab.
  9. The customer pastes, chooses their own rating and decides whether to post, on Google.
Private feedback link is available throughout.
```

### 1–3. Resolving the business and session

The page resolves the QR code or slug on the server (`apps/web/lib/customer/public-business.ts`).
Only an `ACTIVE`, non-deleted business is served. On `/r/{code}` a disabled QR or an unpublished or
suspended business gets a controlled "not available" page; `/{slug}/review` answers 404 in that case.
A retired slug redirects to the current one. The
Google URL and label come live from `review_destinations`, so an owner's change applies on the next
scan.

The `dh_anon` cookie is minted by `apps/web/proxy.ts` and turned into a per-business
`anonymous_sessions` row by `apps/web/lib/customer/anonymous-session.ts` (see
[security](../architecture/security.md#anonymous-customer-session)). Without a cookie the page still
works; it is simply not tied to a session, so the scan is not recorded and there is no saved draft to
offer.

Service labels come from `ai_business_contexts.services`, which the owner maintains on
`/app/ai-review`. Only the labels are sent to the browser (`loadPublicServices`); the owner's summary
and context terms stay on the server.

### 4. The services screen

`ReviewFlow` (`apps/web/components/customer/review/ReviewFlow.tsx`) **always starts on the services
screen with nothing selected**, on every scan, revisit and reload, even when the session already has
a draft. `ServicePicker` lets the customer choose one or more services. "Create my draft" is enabled
once at least one is chosen and the chosen labels total at most 600 characters. A business with no
services configured shows "Start" instead and can ask for a general draft with no selection.

Buttons stay disabled until the page has hydrated, so an early tap on a slow phone is not lost.

### 5. Asking for a draft

The browser posts `{ slug, qr_code, selected_services, previous_generation_id? }` to
`POST /api/v1/public/review/generate`. The server resolves the business again from the slug or QR
code (never from an id sent by the browser), checks that each selected service is one of this
business's current labels (at most 30 choices, 80 characters each, 600 in total), and answers `422`
with "Refresh this page and choose again" when the list has changed. Validation happens before rate
limiting, quota or any provider call. Generation itself — prompts, quota, retries — is described in
[Ai generation](ai-generation.md).

The browser retries once, after about 1.5 seconds, when the server answers 503. On failure the
customer sees a plain message and can try again or write their own review; a draft they already had
stays available.

### Draft recovery

- The page passes this session's **latest stored draft** (the original generated text) to
  `ReviewFlow` on both `/r/{code}` and `/{slug}/review`. It appears only behind **"Return to draft"**
  on the services screen.
- Returning to a draft makes no request to the generate endpoint and does not use an Ai draft.
- The services a draft was made from are remembered in `sessionStorage` under
  `ai-review:services:v1:<slug or QR code>`, together with the draft's generation id. They are
  restored only if the id matches and every service still exists. Otherwise the draft is still
  usable, but "New review" first asks the customer to choose services again.
- Choosing new services replaces the old selection. Unsaved edits are browser state only and are lost
  on a full page reload; the reload offers the original stored draft.

### 6–8. Editing, confirming, copying and opening Google

`DraftEditor` (`apps/web/components/customer/review/DraftEditor.tsx`):

- The text is freely editable up to **1,200 characters**. Any edit clears the confirmation. The
  first edit records `review_edit`.
- **"New review"** asks for another draft (it counts as one more Ai draft) and clears the
  confirmation, because the new text has not been read yet.
- **"Copy & open Google"** is enabled only when the box is ticked, the text is not empty and within
  the limit. It is a link, not a script-opened window: the click starts the clipboard write
  synchronously, records `google_open`, and the link opens the Google review page in a new tab.
  `review_copy` is recorded only when the clipboard write succeeds.
- **Clipboard fallback.** If the browser has no clipboard API (for example plain HTTP on a local
  network), the tab does not navigate; the text is selected for the device's own Copy command and an
  "Open Google" link is shown. If the write is attempted and refused, the page left behind shows the
  same fallback. "Copied" appears only after a successful write.
- With no Google link configured, the button becomes "Copy review" and nothing is opened.
- Copying, editing and opening Google never use an Ai draft.

### Private feedback branch

When the business has a slug, every screen shows "Send private feedback instead", linking to
`/{slug}/feedback`. That page records `private_feedback_open` on render and posts to
`/api/v1/public/feedback`. It is covered in [feedback and CRM](feedback-and-crm.md).

## What is stored where

| Data                                                              | Where                                                           |
| ----------------------------------------------------------------- | --------------------------------------------------------------- |
| Visitor token                                                     | `dh_anon` cookie (HttpOnly, 30 days)                            |
| Session per business (token hash, UA and IP-prefix hashes)        | `anonymous_sessions`                                            |
| Each generated draft, as generated, with model and prompt version | `ai_generations`                                                |
| Selected services for the latest draft (no review text)           | Browser `sessionStorage`                                        |
| The customer's edits and the confirmation tick                    | Browser memory only; never sent or stored                       |
| Funnel events (scan, generate, edit, confirm, copy, Google open)  | `analytics_events` (identifiers only; no text, no contact data) |
| Private feedback                                                  | `private_feedback`                                              |

## Where the code lives

| What                              | Path                                                                                                                           |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| QR landing page                   | `apps/web/app/(customer)/r/[code]/page.tsx`                                                                                    |
| Slug review page                  | `apps/web/app/(customer)/[slug]/review/page.tsx`                                                                               |
| Flow, picker, editor, styles      | `apps/web/components/customer/review/` (`ReviewFlow.tsx`, `ServicePicker.tsx`, `DraftEditor.tsx`, `CustomerReview.module.css`) |
| Business and QR resolution        | `apps/web/lib/customer/public-business.ts`, `apps/web/lib/customer/resolve-public-ref.ts`                                      |
| Service list rules and validation | `apps/web/lib/customer/customer-services.ts`                                                                                   |
| Anonymous session                 | `apps/web/proxy.ts`, `apps/web/lib/customer/anonymous-session.ts`                                                              |
| Latest-draft lookup               | `loadLatestDraft` in `apps/web/lib/ai/generation-service.ts`                                                                   |
| Generate endpoint                 | `apps/web/app/api/v1/public/review/generate/route.ts`                                                                          |
| Event endpoint                    | `apps/web/app/api/v1/public/events/route.ts`                                                                                   |
| Feedback page and endpoint        | `apps/web/app/(customer)/[slug]/feedback/page.tsx`, `apps/web/app/api/v1/public/feedback/route.ts`                             |
| Browser tests                     | `e2e/customer/customer-review-flow.spec.ts` and the rest of `e2e/customer/`                                                    |

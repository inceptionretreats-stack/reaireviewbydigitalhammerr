# Feedback and CRM

This document covers the three owner-facing tools that sit beside the review flow: the private
feedback inbox, the customer contact list (CRM), and manual WhatsApp review requests with tracked
links. It explains what each stores, which statuses exist and who may set them, and what the product
deliberately does not do. Read it before changing `apps/web/lib/feedback/`, `apps/web/lib/crm/`, the
matching API routes or the `/app/feedback`, `/app/customers` and `/app/review-requests` screens.

## Private feedback

A customer can write to the business privately instead of, or as well as, reviewing on Google. It is
offered to every visitor equally, from the review flow, the public business page or a direct link;
nothing asks how the visit went first, so there is no path that steers unhappy customers away from
Google. Feedback is not published anywhere and is not a support ticket to Digital Hammerr.

**Customer side.** `/{slug}/feedback` (`apps/web/app/(customer)/[slug]/feedback/page.tsx`) records
`private_feedback_open` when it renders and shows `FeedbackForm`. The form posts to
`POST /api/v1/public/feedback`, which:

- resolves the business from the slug on the server (missing and suspended businesses answer the
  same);
- validates a required message of 5–2,000 characters and optional name (up to 120) and mobile (up to
  20, normalised when it is a valid number);
- applies the shared rate limiter (per anonymous session and per network prefix), then a database
  cap of 5 submissions per session per hour, with one shared bucket of 5 per hour per business for
  callers that send no session cookie;
- stores the row in `private_feedback` with status `NEW` and records `private_feedback_submit`
  carrying identifiers only.

The customer's name, mobile and message never go into analytics, logs or error responses.

**Owner side.** `/app/feedback` lists messages through `GET /api/v1/feedback`, with filters
`inbox` (the default: `NEW` and `READ`), `new`, `read`, `archived` and `all`, plus a date range and
paging. `PATCH /api/v1/feedback/{id}` sets `READ` or `ARCHIVED`; restoring an archived message makes
it `READ`. Nothing deletes feedback. This endpoint is the only place contact details are returned, it
is session-guarded and `no-store`, and there is intentionally no export. A suspended business can
still read and file its messages.

## Customer contact list (CRM)

`/app/customers` is a simple list of people the owner may want to ask for a review, one at a time. It
is not a marketing tool: there is no import, export, bulk action, campaign or segment, by design.

- `GET`/`POST /api/v1/customers` list (search by name or phone digits, status filter, pagination) and
  create; `PATCH`/`DELETE /api/v1/customers/{id}` edit and delete.
- A contact has a name, a mobile number (normalised to E.164), optional email, visit date and note,
  and a status. A mobile number may belong to only one live contact per business; the check and the
  insert share a transaction.
- Deletion is a soft delete (`customers.deleted_at`); deleted contacts disappear from the list, the
  request composer and the request history.
- Every query carries the business id from the session in its `WHERE` clause
  (`apps/web/lib/crm/customers/repository.ts`), so another business's contact is simply not found.

### Customer statuses

`customers.status` uses the `customer_request_status` enum. Who may write each value is fixed in
`apps/web/lib/crm/customers/customer-status.ts`:

| Status                                           | Set by                                                 | Written today?       |
| ------------------------------------------------ | ------------------------------------------------------ | -------------------- |
| `NOT_CONTACTED`                                  | Default; the owner can set it back                     | yes                  |
| `MESSAGE_PREPARED`                               | Preparing a review request                             | yes                  |
| `MESSAGE_SENT_MANUAL`                            | The owner's "mark sent", or chosen in the contact form | yes                  |
| `LINK_CLICKED`                                   | The customer opening the tracked link                  | yes                  |
| `AI_GENERATED`, `REVIEW_COPIED`, `GOOGLE_OPENED` | Reserved for the customer's later progress             | **no writer exists** |
| `PRIVATE_FEEDBACK`                               | Reserved for a customer who wrote privately            | **no writer exists** |

Automatic changes only move a contact forward along the ladder in
`apps/web/lib/crm/review-requests/customer-journey.ts` (`NOT_CONTACTED` → … → `GOOGLE_OPENED`), in
one conditional `UPDATE`, so preparing a second message never pushes a contact who already clicked
back to "prepared". `PRIVATE_FEEDBACK` is a branch, not a rung. Once a contact reaches an observed
status (`LINK_CLICKED` or later) the owner can no longer change its status by hand. Do not describe a
complete
per-customer funnel: nothing yet links a contact to their draft, copy or Google open.

## Manual WhatsApp review requests

The product **never sends WhatsApp messages** and has no API integration that could. It prepares
text and a link; the owner sends it from their own phone.

1. On `/app/review-requests` the owner picks a contact and edits the message. The template may use
   `{customer_name}`, `{business_name}` and `{review_link}`; unknown placeholders are left as typed
   and flagged. `POST /api/v1/review-requests/preview` renders it without saving.
2. `POST /api/v1/review-requests` (business must be `ACTIVE`) issues a random tracking token, stores
   only its SHA-256 and the rendered message in `review_requests`, moves the contact to
   `MESSAGE_PREPARED`, records `review_request_prepared`, and returns the message, the tracked link
   `/r/req/{token}` and, when the mobile number is valid, a `wa.me` link with the text filled in.
3. The owner copies the message or opens WhatsApp and sends it.
4. `POST /api/v1/review-requests/{id}/mark-sent` records the owner's claim that they sent it. It is
   not delivery confirmation. The first time is kept if it is pressed twice. The contact moves to
   `MESSAGE_SENT_MANUAL` and `review_request_marked_sent` is recorded.
5. When the customer opens the link, `GET /r/req/{token}` checks the token's shape, looks it up by
   hash, stamps first and last click times, records `review_request_link_click`, moves the contact to
   `LINK_CLICKED`, and answers a `no-store` 302 to the business's current `/{slug}/review`. Fetches
   by messaging apps building a link preview are recognised by user agent and not counted.
   Unknown tokens go to the site root; a suspended or unpublished business is still counted but
   redirected to its "not available" page.

Limits to keep in mind: tracking tokens have no expiry column, so a link works until its request row
is deleted, and the resolver does not check whether the contact was soft-deleted. Deleting a contact
therefore does not revoke links already sent. The only copy of a usable link is inside the stored
message text.

## Where the code lives

| What                             | Path                                                                                                         |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Feedback page and form           | `apps/web/app/(customer)/[slug]/feedback/page.tsx`, `apps/web/components/customer/feedback/FeedbackForm.tsx` |
| Feedback submission              | `apps/web/app/api/v1/public/feedback/route.ts`                                                               |
| Feedback inbox                   | `apps/web/app/api/v1/feedback/`, `apps/web/lib/feedback/`, `apps/web/components/dashboard/feedback/`         |
| Customer API                     | `apps/web/app/api/v1/customers/`                                                                             |
| Customer rules and queries       | `apps/web/lib/crm/customers/`                                                                                |
| Customer screen                  | `apps/web/components/dashboard/customers/`                                                                   |
| Review-request API               | `apps/web/app/api/v1/review-requests/`                                                                       |
| Templates, tokens, status ladder | `apps/web/lib/crm/review-requests/`                                                                          |
| Tracked-link resolver            | `apps/web/app/(customer)/r/req/[token]/route.ts`                                                             |
| Review-request screen            | `apps/web/components/dashboard/review-requests/`                                                             |
| Tables                           | `packages/db/src/schema/crm.ts`                                                                              |

Related: [customer review flow](customer-review-flow.md), [data model](../architecture/data-model.md),
[security](../architecture/security.md#privacy).

# Vendor onboarding

This document follows a business owner ("vendor") from sign-up to a published public page with a
printable QR code: what the account creation does in the database, the five onboarding steps, what
publishing requires and creates, how the public page and slug work, and how an owner changes their
Google review link or page address without reprinting QR codes. Read it before changing sign-up,
the onboarding wizard, publishing, the profile editor or QR management.

## 1. Creating an account

**Email and password** (`/signup`, `apps/web/components/auth/SignupForm.tsx`). The form sends full
name, email, mobile, password and a ticked terms box to `POST /api/v1/auth/signup`, which:

1. checks the CSRF origin and a per-network sign-up rate limit;
2. validates the body (`signupRequest` in `packages/contracts/src/auth.ts`), password strength, and
   normalises the mobile number to E.164 (a bare 10-digit number is treated as Indian);
3. in **one transaction**, creates the `users` row (role `BUSINESS_OWNER`), a **shell business** in
   status `DRAFT` (named after the owner, category `PENDING`, timezone `DEFAULT_TIMEZONE`), and a
   `FREE` `subscriptions` row whose draft limits and price are copied from `platform_settings`;
4. creates a session and sets the cookie.

If step 4 fails after the transaction committed, the response says the account was created and
asks the owner to sign in — it never asks them to register the same email again. An email that is
already registered is reported as such (sign-up cannot work otherwise). The form then sends the owner
to `/onboarding/business`.

**Google** (`/signup` or `/login` with the Google button, shown only when `GOOGLE_CLIENT_ID` is set).
Google proves identity only; it does not supply business details, a Google Business Profile or a
review link. The server verifies the ID token and then:

- a Google account already linked to a vendor signs straight in to `/app`;
- a new email goes to `/signup/google`, where the owner supplies name and mobile and accepts the
  terms; `POST /api/v1/auth/google/complete` then creates the same user, shell business and Free
  subscription as the password flow, with no password, and links the Google subject in
  `google_identities`;
- an email that already has a password account goes to `/signup/google` to confirm that password
  once; `POST /api/v1/auth/google/link` then links Google to it;
- admin accounts cannot use Google.

After either path the owner completes the same onboarding. Setup and verification:
[Google sign-in](../operations/google-sign-in.md).

## 2. The onboarding wizard

The step list is defined once in `apps/web/lib/onboarding/steps.ts`; the progress bar, next/back
navigation and resume logic all read it.

| Step | URL                       | Required to publish | What the owner does                                                          |
| ---- | ------------------------- | ------------------- | ---------------------------------------------------------------------------- |
| 1    | `/onboarding/business`    | yes                 | Business name, category, short description, city, state, page address (slug) |
| 2    | `/onboarding/review-link` | yes                 | Google review link (validated to a known Google host, HTTPS)                 |
| 3    | `/onboarding/links`       | no                  | WhatsApp, call, Instagram, Facebook, website, directions, custom link        |
| 4    | `/onboarding/ai`          | no                  | Business summary, services, context terms, draft language, a test preview    |
| 5    | `/onboarding/finish`      | —                   | Review and publish                                                           |

Progress is **derived from stored data**, not from a saved "current step"
(`apps/web/lib/onboarding/progress.ts`). Business details count as done once the category is no
longer the placeholder, a city is set and a primary slug exists; the review link once a primary
review destination exists. `/onboarding` sends a `DRAFT` business to the first unfinished required
step, or to the finish step when both are done; a business that is already published goes to the
finish step. Optional steps can be skipped with "Skip optional" and are never demanded again.

Endpoints used: `PATCH /api/v1/business` (identity; the slug is claimed first so a taken slug
changes nothing), `GET /api/v1/business/slug-available`, `PUT /api/v1/business/review-destination`,
`PUT /api/v1/business/links`, `PUT /api/v1/ai/context` (the first save also creates a "Balanced"
review mode) and `POST /api/v1/ai/test-preview` (a preview draft that does not use the business's
draft allowance; see [Ai generation](ai-generation.md)).

## 3. Publishing

`POST /api/v1/business/publish` enforces readiness on the server:

- a `SUSPENDED` or `CLOSED` business cannot publish;
- it reports what is missing (`business_details`, `web_address`, `google_review_link`) if the
  business still has its placeholder identity, has no primary slug, or has no primary review
  destination. Contact links and Ai context never block publishing.

When ready, one transaction sets the business `ACTIVE`, keeps the original `published_at` on a
republish, bumps `config_version`, adds a default "Review Us" section if the business has no public
page sections, and creates the first QR code, labelled **Main QR**, if it has none. The response
returns the public page URL, the QR code and its URL.

The dashboard (`/app`) then shows setup progress across all five steps, the public page, live
figures and the plan. Everything after that is managed from the `/app/*` screens listed in
[routes](../architecture/routes.md#vendor-workspace--appvendor).

## 4. The public page and slug

- `/{slug}` is the public business page (`apps/web/app/(customer)/[slug]/page.tsx`): contact buttons
  in the owner's order, a "Review us" button that opens the Google link directly, and a private
  feedback link. It is **not** the Ai review flow; that is `/{slug}/review` or `/r/{code}` (see
  [customer review flow](customer-review-flow.md)).
- Only `ACTIVE`, non-deleted businesses are served. `DRAFT`, `SUSPENDED` and `CLOSED` businesses get a
  controlled "not available" page rather than a 404.
- Slugs are 3–48 characters and must not be on the reserved list in
  `packages/core/src/business/slug.ts` (route names such as `r`, `api`, `app`, `admin`, `legal`,
  `review`). Live and retired slugs share one namespace.
- Changing the slug keeps the old one as a redirect to the new page for 180 days
  (`packages/core/src/business/slug-service.ts`), including its `/review` and `/feedback` paths.
- Sections render only when they have a usable target; stored URLs must be `http(s)`. Logo, cover and
  brand-colour editing are not available in the profile editor yet.

## 5. Changing the Google link or location without reprinting

A printed QR encodes only `APP_BASE_URL` + `/r/{code}`, where the code is a random 10-character value
(`packages/core/src/qr/code.ts`). Everything it leads to is read when the customer scans:

- The Google review URL lives in `review_destinations` and nowhere else. The `GOOGLE_REVIEW` row in
  `business_links` controls only whether and where the button appears. Editing the link in
  `/app/profile` calls `PUT /api/v1/business/review-destination`, which validates it and updates it
  and the business's `config_version` in one transaction. Every existing QR and page uses the new link
  on the next visit. Do not replace the QR payload with a literal Google link.
- A slug change does not affect QR codes, and old slugs redirect.
- `/app/qr` can add more QR sources with their own labels (for example one per counter) so analytics
  can tell them apart, rename them, disable one (it then shows the "not available" page) or
  re-enable it, and download print-ready SVG or PNG cards (`GET /api/v1/qr/{id}/download`). New QR
  sources can be created only once the business is published.
- Because `APP_BASE_URL` is printed into every QR, it must be the stable public HTTPS origin.
  Production configuration rejects a local, private or plain-HTTP value, and a temporary tunnel
  address is not suitable for printed codes.

Profile edits are separate requests per section (identity, individual links, reorder), not one
all-or-nothing save; reordering saves immediately.

## Where the code lives

| What                          | Path                                                                                                                             |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Sign-up form and endpoint     | `apps/web/components/auth/SignupForm.tsx`, `apps/web/app/api/v1/auth/signup/route.ts`                                            |
| Shell business helpers        | `apps/web/lib/tenant/tenant-shell.ts`                                                                                            |
| Google sign-in                | `apps/web/components/auth/GoogleSignIn.tsx`, `apps/web/components/auth/GoogleFinishForm.tsx`, `apps/web/app/api/v1/auth/google/` |
| Wizard steps and progress     | `apps/web/lib/onboarding/steps.ts`, `apps/web/lib/onboarding/progress.ts`                                                        |
| Wizard pages and components   | `apps/web/app/(vendor)/onboarding/`, `apps/web/components/onboarding/`                                                           |
| Business identity and slug    | `apps/web/app/api/v1/business/route.ts`, `packages/core/src/business/slug-service.ts`                                            |
| Google review link            | `apps/web/app/api/v1/business/review-destination/route.ts`, `packages/core/src/business/review-url.ts`                           |
| Public page sections          | `apps/web/app/api/v1/business/links/`, `apps/web/components/dashboard/profile/ProfileEditor.tsx`                                 |
| Publishing                    | `apps/web/app/api/v1/business/publish/route.ts`                                                                                  |
| Public page                   | `apps/web/app/(customer)/[slug]/page.tsx`, `apps/web/components/customer/profile/PublicProfile.tsx`                              |
| QR sources and printable card | `apps/web/app/api/v1/qr/`, `apps/web/lib/qr/`, `apps/web/components/dashboard/qr/`                                               |
| Dashboard overview            | `apps/web/components/dashboard/overview/`, `apps/web/lib/dashboard/summary.ts`                                                   |

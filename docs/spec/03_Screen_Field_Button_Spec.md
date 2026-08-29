# Screen, Field and Button Specification

This file is the UI contract for V1. Required fields are marked `*`. Client-side validation improves UX; server-side validation is authoritative.

## AUTH-01 - `/signup`
**Role:** Business  
**Purpose:** Create a business owner account

**Fields / content**
- Full name* (2-80 chars)
- Email* (valid, unique)
- Mobile* (E.164/Indian validation)
- Password* (12+ chars; strength rules)
- Terms/privacy checkbox*

**Buttons / actions**
- Create account
- Sign in

**Required UI states**
- `default`
- `submitting`
- `email exists`
- `validation error`
- `success`

**Acceptance notes**
- Creates user and pending/default business shell
- Never reveals whether an arbitrary email exists beyond standard account flow
- Password is never logged

## AUTH-02 - `/login`
**Role:** Business/Admin  
**Purpose:** Authenticate

**Fields / content**
- Email*
- Password*
- Remember me (optional)

**Buttons / actions**
- Sign in
- Forgot password
- Create account

**Required UI states**
- `default`
- `loading`
- `invalid credentials`
- `locked/rate limited`
- `success`

**Acceptance notes**
- Valid credentials create secure session
- Repeated failures trigger rate limit
- Admin routing is role-aware

## AUTH-03 - `/forgot-password`
**Role:** Business/Admin  
**Purpose:** Request reset

**Fields / content**
- Email*

**Buttons / actions**
- Send reset link
- Back to sign in

**Required UI states**
- `default`
- `sent`
- `rate limited`

**Acceptance notes**
- Always returns neutral success wording
- Reset token is single-use and expires

## ONB-01 - `/onboarding/business`
**Role:** Business  
**Purpose:** Collect core business identity

**Fields / content**
- Business name*
- Category*
- Short description (0-500)
- City*
- State*
- Logo upload (png/jpg/webp <=5MB)
- Desired slug*

**Buttons / actions**
- Continue
- Save & exit

**Required UI states**
- `default`
- `slug available`
- `slug unavailable`
- `uploading`
- `saved`

**Acceptance notes**
- Slug unique case-insensitively
- Logo validated by MIME and magic bytes
- Creates/updates business tenant

## ONB-02 - `/onboarding/review-link`
**Role:** Business  
**Purpose:** Configure primary Google review destination

**Fields / content**
- Google review URL*

**Buttons / actions**
- Validate link
- Continue
- How to find my Google review link

**Required UI states**
- `default`
- `valid`
- `invalid/unsupported`
- `saved`

**Acceptance notes**
- HTTPS required
- Allowed google.com/maps.app.goo.gl patterns accepted after validation
- URL stored normalized

## ONB-03 - `/onboarding/links`
**Role:** Business  
**Purpose:** Set default contact/social links

**Fields / content**
- WhatsApp number
- Call number
- Instagram URL
- Facebook URL
- Website URL (optional)

**Buttons / actions**
- Continue
- Skip optional

**Required UI states**
- `default`
- `validation`
- `saved`

**Acceptance notes**
- Default five sections are created
- Blank optional URLs are not rendered publicly

## ONB-04 - `/onboarding/ai`
**Role:** Business  
**Purpose:** Configure AI business context

**Fields / content**
- Business summary
- Services/products tags (0-30)
- Context terms (0-30)
- Default mode name

**Buttons / actions**
- Generate preview
- Continue

**Required UI states**
- `default`
- `preview loading`
- `preview ready`
- `AI error`

**Acceptance notes**
- Terms are context, not mandatory output
- Preview does not consume free quota
- Unsafe/unsupported fields rejected

## ONB-05 - `/onboarding/finish`
**Role:** Business  
**Purpose:** Publish business and create first QR

**Fields / content**
- Public page preview
- AI review preview
- Canonical URL

**Buttons / actions**
- Publish
- Download QR
- Go to dashboard

**Required UI states**
- `draft`
- `publishing`
- `live`

**Acceptance notes**
- Publish creates default QR source
- Canonical route works immediately

## PUB-01 - `/{slug} or custom-domain /`
**Role:** Public customer  
**Purpose:** Business trust/link page

**Fields / content**
- Logo/cover/name/description
- Enabled ordered sections only

**Buttons / actions**
- Review Us
- WhatsApp
- Call
- Instagram
- Facebook
- Website
- Directions
- Other configured sections

**Required UI states**
- `live`
- `business disabled`
- `expired policy state`

**Acceptance notes**
- No login required
- Hidden/blank sections never render
- Clicks emit analytics without blocking navigation

## REV-01 - `/r/{qrCode} and /{slug}/review`
**Role:** Public customer  
**Purpose:** Generate AI-assisted review draft

**Fields / content**
- Business identity
- AI disclosure
- No questionnaire

**Buttons / actions**
- Generate My Review
- Send Private Feedback
- View business links

**Required UI states**
- `ready`
- `generating`
- `quota/abuse blocked`
- `AI unavailable`

**Acceptance notes**
- One tap starts generation
- No star rating asked
- Public request is rate limited

## REV-02 - `same client flow`
**Role:** Public customer  
**Purpose:** Edit/regenerate/copy draft

**Fields / content**
- Editable review text area
- Genuine-experience confirmation checkbox*

**Buttons / actions**
- Regenerate
- Copy Review
- Send Private Feedback

**Required UI states**
- `draft`
- `edited`
- `regenerating`
- `copied`

**Acceptance notes**
- Copy disabled until confirmation is checked
- Regenerate returns materially different draft
- Customer can freely edit before copy

## REV-03 - `same client flow`
**Role:** Public customer  
**Purpose:** Continue to external review platform

**Fields / content**
- Copied state
- Primary platform label

**Buttons / actions**
- Continue to Google
- Back to edit

**Required UI states**
- `copied`
- `opening`

**Acceptance notes**
- Records google_open immediately before navigation
- Does not claim submission
- Uses configured current destination

## FB-01 - `/{slug}/feedback`
**Role:** Public customer  
**Purpose:** Submit private feedback

**Fields / content**
- Name optional
- Mobile optional
- Message* 5-2000 chars

**Buttons / actions**
- Submit Feedback
- Back

**Required UI states**
- `default`
- `submitting`
- `success`
- `error`

**Acceptance notes**
- Available to every visitor regardless of sentiment
- Data stored privately for the business

## DASH-01 - `/app`
**Role:** Business  
**Purpose:** Dashboard overview

**Fields / content**
- Date range
- KPI cards
- Funnel chart
- Top QR sources
- Top link clicks
- Subscription status

**Buttons / actions**
- Change range
- View analytics
- Manage QR
- Upgrade/Renew

**Required UI states**
- `loading`
- `data`
- `empty`

**Acceptance notes**
- All metrics scoped to active business
- No metric named Review Submitted

## AI-01 - `/app/ai-review`
**Role:** Business  
**Purpose:** Manage AI context and default behavior

**Fields / content**
- Business AI summary
- Services/products tags
- Context terms
- Active mode
- Prompt preview explanation

**Buttons / actions**
- Save
- Test preview
- Reset to profile data

**Required UI states**
- `saved`
- `dirty`
- `test loading`
- `test result`

**Acceptance notes**
- Test does not use paid/free quota
- Business cannot edit global system prompt

## AI-02 - `/app/review-modes`
**Role:** Business  
**Purpose:** Create/switch review modes

**Fields / content**
- Mode name*
- Description
- Context tags
- Active toggle

**Buttons / actions**
- Create mode
- Edit
- Duplicate
- Activate
- Archive

**Required UI states**
- `list`
- `create`
- `edit`
- `archived`

**Acceptance notes**
- Only one active mode at a time
- Archived modes cannot be active
- Changing mode does not change QR

## QR-01 - `/app/qr`
**Role:** Business  
**Purpose:** Manage dynamic QR sources

**Fields / content**
- Source label*
- Internal note
- Destination behavior fixed to AI review V1
- Status

**Buttons / actions**
- Create QR
- Download SVG
- Download PNG
- Rename
- Disable
- Enable

**Required UI states**
- `list`
- `create`
- `disabled`

**Acceptance notes**
- Each QR has immutable opaque code
- Disabled QR shows business-safe unavailable state or canonical fallback
- Source label appears in analytics

## PROFILE-01 - `/app/profile`
**Role:** Business  
**Purpose:** Edit trust page

**Fields / content**
- Logo
- Cover
- Business name
- Description
- Brand accent
- Section list
- Each section URL/content
- Visibility
- Order

**Buttons / actions**
- Save
- Preview
- Add section
- Hide/Show
- Drag to reorder

**Required UI states**
- `editing`
- `saved`
- `preview`

**Acceptance notes**
- Default five sections exist
- Blank URL cannot be enabled
- Order persists and renders publicly

## CRM-01 - `/app/customers`
**Role:** Business  
**Purpose:** Simple review-request contact list

**Fields / content**
- Name*
- Mobile*
- Email optional
- Visit date optional
- Note optional
- Manual status

**Buttons / actions**
- Add customer
- Edit
- Delete
- Prepare review request
- Search

**Required UI states**
- `list`
- `empty`
- `form`

**Acceptance notes**
- No bulk marketing automation
- Deletion is soft or auditable
- Phone values normalized

## REQ-01 - `/app/review-requests`
**Role:** Business  
**Purpose:** Prepare personal review request message

**Fields / content**
- Customer selector
- Message template
- Resolved preview
- Review link

**Buttons / actions**
- Copy Message
- Open WhatsApp
- Mark Message Sent

**Required UI states**
- `preview`
- `copied`
- `sent-manual`

**Acceptance notes**
- Open WhatsApp uses wa.me style deep link where valid
- No platform-sent WhatsApp message
- Status clearly says manual

## FB-02 - `/app/feedback`
**Role:** Business  
**Purpose:** View private feedback

**Fields / content**
- Date/status filters
- Feedback cards/table
- Name/mobile if supplied
- Message

**Buttons / actions**
- View
- Mark read
- Archive

**Required UI states**
- `list`
- `detail`
- `empty`

**Acceptance notes**
- Only own business feedback visible
- PII excluded from analytics exports by default

## AN-01 - `/app/analytics`
**Role:** Business  
**Purpose:** Detailed analytics

**Fields / content**
- Date range
- Funnel
- QR source table
- Link clicks
- Daily trend
- Unique visitors

**Buttons / actions**
- Filter
- Export CSV (optional V1 flag)
- Open QR detail

**Required UI states**
- `loading`
- `data`
- `empty`

**Acceptance notes**
- Metric definitions match event taxonomy
- Unique visitor is anonymous-session based, not a person claim

## DOM-01 - `/app/domain`
**Role:** Business  
**Purpose:** Connect custom domain/subdomain

**Fields / content**
- Hostname*
- Displayed DNS target/TXT if required
- Verification/cert status

**Buttons / actions**
- Add Domain
- Check Status
- Remove

**Required UI states**
- `unconfigured`
- `pending DNS`
- `pending SSL`
- `active`
- `error`

**Acceptance notes**
- Only one active custom hostname in V1 per business
- Canonical Digital Hammerr URL always remains available
- Ownership validation required

## SUB-01 - `/app/subscription`
**Role:** Business  
**Purpose:** View/upgrade/renew subscription

**Fields / content**
- Plan
- Price
- Start
- Expiry
- Free generations used/remaining
- Payment history

**Buttons / actions**
- Upgrade ₹999/year
- Renew
- Download receipt

**Required UI states**
- `free`
- `checkout`
- `paid`
- `expired`
- `payment failed`

**Acceptance notes**
- Razorpay signature verified server-side
- Entitlement updated from verified payment/webhook
- 10 free generations enforced atomically

## SET-01 - `/app/settings`
**Role:** Business  
**Purpose:** Account/business settings

**Fields / content**
- Account name
- Email
- Mobile
- Password change
- Business status

**Buttons / actions**
- Save
- Change password
- Log out other sessions

**Required UI states**
- `default`
- `saved`
- `error`

**Acceptance notes**
- Sensitive changes require re-auth where appropriate
- Session revocation works

## ADMIN-01 - `/admin`
**Role:** Super Admin  
**Purpose:** Platform dashboard

**Fields / content**
- Business counts
- Paid/free
- Revenue
- AI generations
- QR scans
- Abuse alerts
- System health

**Buttons / actions**
- Open business
- Open payments
- Open AI config
- Open platform settings

**Required UI states**
- `data`
- `degraded`

**Acceptance notes**
- Only super-admin role allowed
- Every admin mutation audited

## ADMIN-02 - `/admin/businesses`
**Role:** Super Admin  
**Purpose:** Manage business tenants

**Fields / content**
- Search/filter
- Business status
- Owner
- Plan
- Usage
- Domain

**Buttons / actions**
- View
- Suspend
- Reactivate
- Adjust entitlement
- Reset quota with reason
- Impersonate-support read-only

**Required UI states**
- `list`
- `detail`
- `suspended`

**Acceptance notes**
- High-risk actions require reason
- No silent destructive deletion
- Audit log contains actor and before/after

## ADMIN-03 - `/admin/ai`
**Role:** Super Admin  
**Purpose:** Manage AI prompt/model config

**Fields / content**
- Prompt version
- Model
- Reasoning effort
- Max output
- Guardrails
- Rollout percentage

**Buttons / actions**
- Create version
- Test
- Activate
- Rollback

**Required UI states**
- `draft`
- `active`
- `archived`

**Acceptance notes**
- Only one default active production version
- Every generation stores prompt version/model
- Rollback does not require app deploy

## ADMIN-04 - `/admin/settings`
**Role:** Super Admin  
**Purpose:** Manage commercial/platform config

**Fields / content**
- Free quota
- Annual price
- Fair-use limits
- Allowed section types
- Feature flags

**Buttons / actions**
- Save
- Publish config

**Required UI states**
- `draft`
- `published`

**Acceptance notes**
- Config changes versioned/audited
- Price changes do not rewrite historical payments

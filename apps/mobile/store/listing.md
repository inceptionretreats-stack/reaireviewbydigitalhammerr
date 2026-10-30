# Google Play listing: Ai Review (owner app)

Everything needed to fill in Play Console for `com.digitalhammerr.ai_review`. Upload
`build/app/outputs/bundle/release/app-release.aab` (built with `flutter build appbundle --release`,
signed with the upload key; see `../README.md`).

## Store listing

| Field | Value |
| --- | --- |
| App name (≤30) | Ai Review by Digital Hammerr |
| Short description (≤80) | Get more Google reviews with one QR code. Ai helps customers write them. |
| Category | Business |
| Contact email | info@digitalhammerr.com |
| Contact phone | +91 99297 53194 |
| Website | https://aireview.digitalhammerr.com |
| Privacy policy | https://aireview.digitalhammerr.com/legal/privacy |
| App icon (512×512) | `icon-512.png` |
| Feature graphic (1024×500) | `feature-graphic-1024x500.png` |
| Phone screenshots | `screenshots/` (at least 2; add more, see below) |

### Full description (≤4000)

> Aap bas scan karo… Review Ai likh dega.
>
> Ai Review helps local businesses get more genuine Google reviews. Put one QR code on your
> counter, table or bill. Customers scan it, pick the services they used, and Ai helps them put
> their experience into words. They edit the draft, copy it and post it on Google themselves.
> Nothing is posted automatically.
>
> Run it all from your phone:
>
> • Set up your business page and Google review link in a few minutes
> • Create a QR code for every counter, table or desk, and share a print-ready card
> • Ask customers for a review on WhatsApp or SMS with a tracked link
> • Keep your customer list in one place
> • Read private feedback from unhappy customers before it reaches Google
> • See scans, Ai drafts and Google visits day by day
> • Tune what the Ai knows about your business, in English or Hinglish
>
> Ai Review works with your Ai Review account on the website, so everything stays in sync. Made
> for restaurants, cafés, salons, clinics, gyms, shops and every business customers visit.

## App content (Policy section)

| Question | Answer |
| --- | --- |
| Ads | No ads |
| Target audience | 18 and over (business owners) |
| App access | Sign-in required. Give reviewers a working owner account (create one on the website or in the app) and its password |
| Account deletion | In the app: More → your name → **Request account deletion** (emails info@digitalhammerr.com). On the web: the privacy policy, "Your questions and requests". A dedicated web page that lists the deletion steps would make review smoother; Play asks for a URL that explains them |
| Financial features | None in the store build (in-app purchase is off; see README) |
| Government app / news / health | No |

### Data safety

| Data | Collected | Purpose | Notes |
| --- | --- | --- | --- |
| Name, email address, phone number | Yes | Account management | The owner's own account |
| Other people's contact info (customers' name, phone, optional email) | Yes | App functionality | Entered by the owner for review requests |
| Messages (private feedback text) | Yes | App functionality | Written by the owner's customers on the website, read in the app |
| Payment info | No (store build) | — | Razorpay only when in-app purchase is turned on |
| Location, photos, contacts book, device IDs | No | — | |

- Data is encrypted in transit (HTTPS only in release builds).
- Data is not shared with third parties for advertising. It is not sold.
- Users can request deletion (see Account deletion above).
- The session token is kept in the Android Keystore on the device.

## Screenshots

`screenshots/01-landing.png` and `screenshots/02-qr-codes.png` come from a local test run. Before
launch, capture the rest on a phone signed in to a real business on the live site so the screens
show the production address, not a test one. Suggested set: Home, QR code detail, Customers,
review request preview, Feedback inbox, Analytics.

## Before the first upload

1. Upload the bundle to an internal testing track first.
2. Copy the **App signing key** SHA-256 from Play Console → Setup → App signing into
   `apps/web/public/.well-known/assetlinks.json` (keep the upload key entry), then deploy the
   website. This makes dashboard links open in the Play-installed app.
3. Back up the upload keystore and `android/key.properties` (see README).

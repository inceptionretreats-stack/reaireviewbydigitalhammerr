# Google sign-in for vendors

How "Continue with Google" for business owners is configured: the Google Cloud project, the
`GOOGLE_CLIENT_ID` variable, the database migration it needs and what to test. Read it before
changing the Google client, its authorised origins or the sign-in flow. How the flow works in code
is covered in the architecture and feature docs.

The existing email/password and vendor onboarding flows remain in place. Google Identity
Services only proves the vendor's Google account identity; it does **not** fetch a Google
Business Profile, location, reviews, or the business's review URL. Vendors still supply
their business details through onboarding.

The Google Auth Platform project is `ai-review-509604` in the Inception Google Cloud account,
as selected for this setup. Its public consent-screen name is “Ai Review by Digital Hammerr”
and it is published to an External audience. The application data remains in the separate
Digital Hammerr Supabase project `vouqzekpujgzsplhqqor`; Google Cloud is only the identity
provider. The web client has the live origin plus `http://127.0.0.1:3000`,
`http://127.0.0.1:3100`, and `http://localhost:3000` authorized. No billing upgrade was made.

1. In Google Cloud Console, use the selected Inception project. Configure the
   Google Auth Platform branding/audience and create an **OAuth client ID** of type **Web
   application**. Add `https://aireview.digitalhammerr.com` as an authorized JavaScript origin.
   For local testing, also add the exact local origin used (`http://localhost:3000`,
   `http://127.0.0.1:3000`, or `http://127.0.0.1:3100`). GIS popup mode does not require a
   redirect URI or client secret.

2. Set the resulting client ID as `GOOGLE_CLIENT_ID` in the web runtime environment and Vercel
   Production environment. Never put a client secret in a `NEXT_PUBLIC_` variable. Redeploy the
   web app after adding the variable. The Google button is hidden while the ID is absent.
3. Apply Drizzle migration `0008_bent_darkstar` before enabling the button. It preserves all
   password accounts, permits passwordless Google vendors, and stores the immutable Google
   `sub` in `google_identities`. That table has RLS enabled with no Data API grants for `anon`
   or `authenticated`. On production this was done on 24 September 2026, together with
   re-applying the permissions script; see [database on Supabase](database-supabase.md).
4. Test three cases: new Google vendor finishes name/mobile/terms and continues to business
   onboarding; an existing password vendor confirms their password once before linking; a
   returning linked vendor goes straight to their dashboard. Admin accounts cannot use Google
   login; they keep the existing password/MFA path.

The older `https://ai-review-dh.vercel.app` alias sends only login and signup page visits to
`https://aireview.digitalhammerr.com`, the authorized production origin. QR and customer pages
stay on their original host. Do not run GIS on a temporary Vercel deployment URL unless that
exact origin has been separately authorized in Google Cloud.

The app uses the official GIS button and verifies the returned ID token on the server, including
signature, issuer, audience, expiry, verified email, Google subject, and a short-lived browser
nonce. Google is authoritative for current email ownership only for Gmail or Google Workspace;
other Google account email addresses are not marked verified in our database. No Google access
or refresh tokens are requested or stored. Google never sends the vendor's Google password to
this app; returning vendors sign in through Google's account selection. Existing password
vendors can link Google only after confirming their current app password.

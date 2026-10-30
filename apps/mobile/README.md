# Ai Review owner app (Flutter)

The Android and iOS app for business owners. It is the `/app` dashboard of the website in native
form, and it talks to the **same** `/api/v1`. Accounts, sessions and data are shared, so a change made
in the app shows on the website and the other way round. Customers keep using the website: they reach
the review page by scanning a QR code and never need the app.

| Area | Screens |
| --- | --- |
| Landing | What a signed-out visitor sees first: the website's home page messaging, its promo video, how it works, who it's for, pricing teaser |
| Sign in | Sign in, create account, forgot password (the reset link opens on the web) |
| Setup | The website's five onboarding steps: details, Google review link, contact buttons, Ai settings, publish |
| Home | Setup progress or review link, main QR, 30-day stats, plan usage |
| QR codes | List, create, rename, turn on/off, share the printable card |
| Customers | Contacts (search, add, edit, delete), review requests (compose → WhatsApp/SMS → mark sent), history |
| Feedback | Private feedback inbox with filters, read/archive, call or WhatsApp back |
| More | Business profile, Google link, page buttons, Ai settings and modes, analytics, subscription (Razorpay), GST details, account, password, signed-in devices |

## Run it locally

1. Start the website and its database from the repository root (see `AI_HANDOVER.md` §14):

   ```powershell
   pnpm db:dev
   pnpm --filter @ai-review/web dev --hostname 127.0.0.1 --port 3000
   ```

2. Start an Android emulator, then from `apps/mobile`:

   ```powershell
   flutter pub get
   flutter run
   ```

Debug builds talk to `http://10.0.2.2:3000` on the Android emulator (the host's `127.0.0.1`) and to
`http://127.0.0.1:3000` elsewhere. Release builds talk to `https://aireview.digitalhammerr.com`.
To use a different server, pass the website origin:

```powershell
flutter run --dart-define=WEB_BASE_URL=http://10.0.2.2:3100
```

On a physical phone, use your computer's LAN address and start Next with `--hostname 0.0.0.0`.

## How the app connects to the website

The website's own pages use an HttpOnly session cookie and refuse any change request without a
matching `Origin` header (CSRF). A native app can do neither, so the server also accepts
(`apps/web/lib/mobile-client.ts`):

- `X-Client: ai-review-mobile` on every request, and
- `Authorization: Bearer <session token>` once signed in.

Both are headers a cross-site web page cannot send without a CORS preflight, and the website grants no
CORS, so CSRF protection is unchanged. With `X-Client`, login, signup and password change return the
session token in the response body (`session.token`) instead of setting a cookie. The token is a row in
the same `sessions` table as a browser session. "Sign out other devices", a password change or a reset
on the website therefore signs the app out too, and the app then returns to the sign-in screen.
Admin accounts are refused in the app because it has no MFA or admin screens.

The app stores the token in the platform keystore (`flutter_secure_storage`).

Read-only endpoints added for the app, because the web pages read this data directly from the
database:

| Endpoint | Returns |
| --- | --- |
| `GET /api/v1/account` | Name, email, mobile, whether a password is set, number of other signed-in sessions |
| `GET /api/v1/review-requests` | The 20 most recent review requests, with tracked link and WhatsApp link |
| `GET /api/v1/business/review-destination` | Now also `enabled` and `kind` (composer / listing / unknown) |

## Code layout

```
lib/
  main.dart, app/          router (go_router) and the five-tab shell
  core/
    config.dart            which website the app talks to
    api/                   Dio client, error envelope → ApiException
    auth/                  token storage and sign-in state
    models.dart            typed responses (field names match the wire, including its camelCase quirks)
    repository.dart        one method per endpoint
    providers.dart         Riverpod providers, onboarding progress, public URLs
    theme.dart             the website's colours and DM Sans font
    widgets/               shared UI
  features/                one folder per area
```

When a web endpoint changes shape, update `models.dart` and `repository.dart`. Business categories in
`core/catalog.dart` mirror the website's onboarding list.

### Website files the app depends on

- **Promo video** on the landing page: streamed from `{website}/marketing/ai-review-promo.mp4`, the
  file the website's home page plays (`PromoVideoSection`). If it is renamed or moved, update
  `features/welcome/promo_video.dart`. Until then the app shows "Couldn't load the video" with a
  retry button. Its poster is bundled as `assets/images/promo-poster.jpg`.
- **Artwork** in `assets/images/` is copied and resized from `apps/web/public/marketing/`.
- **Font and colours** come from `apps/web/assets/fonts` and `apps/web/app/globals.css` (see `theme.dart`).

### Windows build note

`android/gradle.properties` sets `kotlin.incremental=false`. Without it, the Kotlin compiler fails
with "Could not close incremental caches" when the project (D:) and the pub cache (C:) are on
different drives.

## Checks

```powershell
flutter analyze
flutter test
```

## Release builds

```powershell
flutter build appbundle --release   # build/app/outputs/bundle/release/app-release.aab, for Google Play
flutter build apk --release         # a single installable APK, for testing or direct sharing
```

Release builds talk to production (`https://aireview.digitalhammerr.com`).

### Android signing

Release builds are signed with the **upload key** when `android/key.properties` exists (git-ignored):

```properties
storePassword=…
keyPassword=…
keyAlias=upload
storeFile=C:/Users/<you>/.android-keys/ai-review-upload.jks
```

The keystore lives outside the repository. **Back up the `.jks` file and `key.properties` somewhere
safe.** Every Play Store update must be signed with this key; if it is lost, Google Play support can
reset it, but only after a delay. Without `key.properties`, release builds fall back to the debug key
and cannot be uploaded to Play.

Upload key certificate SHA-256:
`E4:9F:C1:B0:EF:12:F9:E0:00:A5:0C:95:30:35:5D:2A:8C:45:BD:50:6F:76:54:FF:CB:51:29:95:7C:3F:D8:5A`

### Links that open in the app (App Links)

Website dashboard links (`https://aireview.digitalhammerr.com/app` and `/app/…`) open the matching
app screen when the app is installed (`app/router.dart`, `screenForWebPath`). Customer pages, QR links
(`/r/…`) and business pages always stay on the website. Android verifies the link through
`apps/web/public/.well-known/assetlinks.json`.

**After the first Play Store upload**, Google re-signs the app with its own app signing key. Copy that
key's SHA-256 from Play Console → Setup → App signing into `assetlinks.json` alongside the upload key,
and deploy the website. Until then, App Links verify only for builds you sign yourself.

### Buying Pro in the app

Pro can be bought through Razorpay Checkout, verified by the same `/subscription/verify` endpoint as
the website (`AppConfig.inAppPayments`). Google Play allows a non-Play payment system in India only
through its user choice billing programme, alongside Play Billing, with transactions reported to
Google. So in-app purchase is **off by default in release builds**: they show the plan, usage and
payments without a purchase button. To turn it on, for a build shared outside the stores or after
enrolling, pass `--dart-define=IN_APP_PAYMENTS=true`. Debug builds have it on.

## Before publishing to the stores

- **Store listing:** see `store/listing.md` for the text and `store/screenshots/` for phone
  screenshots. The privacy policy URL is `https://aireview.digitalhammerr.com/legal/privacy`.
- **iOS** needs a Mac with Xcode to build. Set the team and bundle identifier in Xcode, then
  `flutter build ipa`.
- **Icons** are generated from the website's `app/icon.svg`: `dart run flutter_launcher_icons`.

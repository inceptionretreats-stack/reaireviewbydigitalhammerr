# Security

This document explains the security boundaries of Ai Review: how people sign in, how one business's
data is kept away from another's, how the admin console is protected, and how the app defends against
cross-site requests, abuse and accidental disclosure of personal data or secrets. Read it before
touching authentication, any API handler that reads or writes business data, the admin area, or
environment configuration. Open problems in these areas are tracked in
[known issues](../known-issues.md).

## Authentication

Authentication is the application's own, backed by PostgreSQL. Accounts are rows in `public.users`;
the hosted database's Supabase Auth (`auth.users`) is not used, and no Supabase client library is
involved. Roles are `BUSINESS_OWNER` (vendors), `BUSINESS_SUPPORT_VIEWER` and `SUPER_ADMIN`.

- **Passwords** are hashed with Argon2id (19 MiB memory, 2 iterations, parallelism 1) with the
  server secret `HASH_PEPPER` mixed in. New passwords need 12–256 characters, at least five distinct
  characters, and must not be on a short deny-list. Accounts created through Google have no password.
- **Sessions** are durable rows in `sessions`. The browser holds a random 32-byte token in an
  HttpOnly, SameSite=Lax cookie (`SESSION_COOKIE_NAME`, default `dh_session`), Secure in production;
  the database stores only its SHA-256. Owners get 30 days, or 90 with "remember me"; a verified
  admin session lasts 12 hours; an admin who has entered only a password gets a 10-minute pending
  session that reaches nothing but the MFA screens. Because sessions are rows, "sign out other
  sessions" and password changes really revoke them. Expired, revoked and missing sessions look the
  same to the caller.
- **Sign-in** is rate-limited per account (5 failures per 15 minutes, 20 per day) and per network
  prefix (25 per 15 minutes). Disabled, deleted or locked accounts cannot sign in. Sign-up is
  rate-limited per network prefix.
- **Password reset** tokens are random, stored as SHA-256, valid for one hour. `forgot-password`
  always answers neutrally. `reset-password` claims the token, changes the password and revokes every
  session for that user in one transaction.
- **Google sign-in** is for vendors only; admins must use password and MFA. The server verifies the
  Google ID token (signature, issuer, audience, expiry, verified email, nonce). The nonce and the
  pending sign-up are kept in short-lived HttpOnly cookies signed with `SESSION_SECRET`. No Google
  access or refresh tokens are requested or stored. Linking Google to an existing password account
  requires that account's password. Setup: [Google sign-in](../operations/google-sign-in.md).

## Tenancy

Every vendor owns exactly one business, and every owner API handler must scope its work to it.

- **`requireTenant(request)`** (`apps/web/lib/tenant/require-tenant.ts`) is the single entry point
  for an owner route. It checks the CSRF origin, loads the session, refuses an admin whose MFA is
  still pending, and resolves the caller's business through `TenantGuard`
  (`packages/core/src/tenant/guard.ts`). It returns a branded `ResolvedTenant` id.
- **A business id from the browser is never authority.** Repository functions take the branded id
  and put it in the SQL `WHERE` clause (for example `apps/web/lib/crm/customers/repository.ts`), so
  another tenant's row is simply not found — the same 404 as a row that does not exist. Filtering a
  row after loading it by id is not acceptable.
- **Business status.** `requireActiveTenant` refuses mutations for a business that is not `ACTIVE`.
  Onboarding endpoints accept a `DRAFT` business but refuse `SUSPENDED` and `CLOSED` ones.
- **Layouts are not authorisation.** The vendor and admin layouts redirect unauthenticated visitors,
  but every API handler must still run its own guard.
- **Public endpoints** resolve the business on the server from the slug or QR code
  (`apps/web/lib/customer/resolve-public-ref.ts`) and answer "not found" and "suspended" the same
  way, so they cannot be used to list businesses.

## Admin roles and MFA

- **`requireAdmin(request, options)`** (`apps/web/lib/auth/require-admin.ts`) guards every admin
  API. It checks CSRF and the session, admits `SUPER_ADMIN`, and admits `BUSINESS_SUPPORT_VIEWER`
  only on read-only routes that opt in with `allowViewer`. A signed-in vendor gets the same answer as
  a stranger.
- **MFA** is TOTP. It is enforced while `ADMIN_MFA_REQUIRED` is `true` (the default); check the
  deployed value before claiming MFA is enforced anywhere. Sensitive actions — refunds, platform
  settings, team changes, MFA resets — pass `stepUp`, which also demands a verification from the last
  15 minutes.
- **MFA secrets** are sealed at rest with AES-256-GCM under a key derived from
  `APP_ENCRYPTION_KEY` (`packages/core/src/crypto/secret-box.ts`). A used time step is remembered to
  stop replay. Eight one-time recovery codes are stored as peppered hashes. MFA attempts are
  rate-limited per pending session, per network prefix and per account per day.
- **Audit.** Admin mutations require a reason and write `admin_audit_logs` with before and after
  state. Signed-in activity (owners and admins) goes to `user_activity_logs`.
- **Creating admins.** There is no first-user promotion. Admins come from
  `scripts/ops/create-admin.mjs` (changes real data) or from an invitation sent from `/admin/team`.

## CSRF

Two layers protect cookie-authenticated mutations (`apps/web/lib/http/csrf.ts`):

1. Session cookies are `SameSite=Lax`, so browsers do not attach them to cross-site POSTs.
2. `verifyCsrf` requires an `Origin` header on every non-`GET`/`HEAD`/`OPTIONS` request and accepts
   only `APP_BASE_URL` or an origin listed exactly in `CSRF_TRUSTED_ORIGINS` (no wildcards; HTTPS and
   a public host in production). Outside production, `localhost` and `127.0.0.1` on ports 3000 and
   3100 are also accepted. Request `Host` and forwarded headers never grant trust.

`requireTenant`, `requireAdmin` and the auth endpoints all call `verifyCsrf`. The public customer
endpoints carry no session and are exempt; the Razorpay webhook is authenticated by its HMAC
signature instead.

## Rate limiting

`apps/web/lib/http/rate-limit.ts` builds one `RateLimiter` (`packages/core/src/rate-limit/`) per
process with Redis as the store and an in-memory store as fallback. During a Redis outage limits
still apply, but per instance. If neither store can answer, public generation and feedback are
allowed (the database draft quota remains the hard limit on generation) while sign-in, sign-up, MFA
and owner previews are refused. Keys use a
peppered hash of the caller's /24 (IPv4) or /48 (IPv6) network prefix, the anonymous session and the
business.

| Check                   | Main limits (defaults)                                                                                                                                      |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public draft generation | 3 per 20 s and 10 per hour per session per business; per-prefix allowance of 20 + 8 per active session, capped at 240 per hour; admin throttle per business |
| Owner preview           | 3 per 30 s and 20 per hour per business                                                                                                                     |
| Private feedback        | Per session and per prefix, plus a database cap of 5 per session per hour                                                                                   |
| Sign-in, MFA, sign-up   | See [authentication](#authentication) and [admin roles](#admin-roles-and-mfa)                                                                               |

`RATE_LIMIT_MULTIPLIER` scales every count (not window) for test environments; it is 1 in
production. The client address comes only from Vercel's forwarding headers when running on Vercel;
`cf-connecting-ip` is honoured only in local development.

## Anonymous customer session

Customers have no account. Continuity across a scan, a draft, a copy and a Google open comes from the
`dh_anon` cookie:

- `apps/web/proxy.ts` mints it (32 random bytes, HttpOnly, SameSite=Lax, Secure in production,
  30 days) on the first request outside `/api/`, `/app/` and `/admin/`, and forwards it to that same
  request, because React Server Components cannot set cookies.
- `apps/web/lib/customer/anonymous-session.ts` only reads it. It stores
  `SHA-256(token + business id)` in `anonymous_sessions`, so one browser has a separate, unlinkable
  session per business, plus hashes of the user agent and IP prefix and a 30-day expiry. The row is
  created lazily by the first request that needs it.
- A request without the cookie still works; it simply is not tied to a session. Public generation
  and feedback still apply the network-prefix and business limits to such callers.

## Privacy

- **No raw IP addresses are stored.** Sessions, activity logs and audit rows keep a peppered SHA-256
  of the address; anonymous sessions and rate-limit keys keep one of the network prefix
  (`privacyHash`, `ipPrefixHash` in `packages/core/src/auth/tokens.ts`).
- **Every token is stored as a hash**: sessions, reset links, invitations and review-request tracking
  links.
- **Customer contact details** (feedback name and mobile, CRM contacts) stay in their tables and the
  owner's session-guarded, `no-store` endpoints. They never go into analytics properties, logs or
  error responses.
- **Errors are logged through `safeError`** (`apps/web/lib/infra/safe-error.ts`), which never
  serialises a database error's message, because Drizzle messages include bound SQL values.

## The hosted database

PostgreSQL runs on Supabase but is used as a plain database by the server only. On that host, every
application table and every `analytics_events` partition has RLS enabled with no policies, and all
privileges are revoked from `PUBLIC`, `anon`, `authenticated` and `service_role`; the Data API is
disabled. The app connects as the table owner, so RLS does not restrict its own queries. This
hardening is `scripts/supabase/lock-down.sql`, kept outside the migration history so local and CI
databases are unaffected; a table added by a later migration needs the same treatment there. Never
add `auth.uid()` policies or put a database key in browser code. Runbook:
[database on Supabase](../operations/database-supabase.md).

## Secrets handling

- Configuration is read only through `apps/web/lib/infra/env.ts`, which validates it with
  `packages/config/src/env.ts` at first use. It is server-only and must never be imported by a client
  component. No secret goes in a `NEXT_PUBLIC_*` variable.
- Real values live only in the git-ignored root `.env` and in the hosting provider's environment.
  `.env.example` carries names only. Never paste `.env`, pulled Vercel environment files, connection
  strings or keys into commits, documents, chats, screenshots or logs.
- Secrets must be at least 16 characters and not start with `CHANGE_ME`; `APP_ENCRYPTION_KEY` needs
  at least 32. In production, validation also fails without an Ai provider key or `CRON_SECRET`.
- Rotating a secret has consequences: `HASH_PEPPER` invalidates every password, recovery code and IP
  hash; `APP_ENCRYPTION_KEY` makes sealed MFA secrets unreadable (admins must re-enrol);
  `SESSION_SECRET` invalidates in-flight Google sign-ins; `CRON_SECRET` and
  `RAZORPAY_WEBHOOK_SECRET` must be changed at the caller too. Plan rotations; never rotate casually.
- Do not log reset or invite links, passwords, customer contact details or provider keys. The
  development mail transport prints links to the console, so treat local logs as sensitive.

Variable names and purposes: [environment variables](../operations/environment.md).

## Where the code lives

| What                       | Path                                                                                                      |
| -------------------------- | --------------------------------------------------------------------------------------------------------- |
| Session cookie and lookup  | `apps/web/lib/auth/session.ts`, `packages/core/src/auth/session.ts`                                       |
| Password hashing and rules | `packages/core/src/auth/password.ts`, `apps/web/lib/auth/password-hasher.ts`                              |
| Token and privacy hashing  | `packages/core/src/auth/tokens.ts`                                                                        |
| Google sign-in             | `apps/web/lib/auth/google-auth.ts`, `apps/web/app/api/v1/auth/google/`                                    |
| Tenant guard               | `apps/web/lib/tenant/require-tenant.ts`, `packages/core/src/tenant/guard.ts`                              |
| Admin guard and MFA        | `apps/web/lib/auth/require-admin.ts`, `apps/web/lib/auth/mfa.ts`, `packages/core/src/auth/mfa-service.ts` |
| Secret sealing             | `packages/core/src/crypto/secret-box.ts`                                                                  |
| Audit and activity         | `packages/core/src/audit/writer.ts`, `apps/web/lib/activity/recorder.ts`                                  |
| CSRF                       | `apps/web/lib/http/csrf.ts`                                                                               |
| Rate limits and client IP  | `apps/web/lib/http/rate-limit.ts`, `packages/core/src/rate-limit/policies.ts`                             |
| Anonymous session          | `apps/web/proxy.ts`, `apps/web/lib/customer/anonymous-session.ts`                                         |
| Environment validation     | `packages/config/src/env.ts`, `apps/web/lib/infra/env.ts`                                                 |
| Safe error logging         | `apps/web/lib/infra/safe-error.ts`                                                                        |
| Hosted-database lock-down  | `scripts/supabase/lock-down.sql`                                                                          |

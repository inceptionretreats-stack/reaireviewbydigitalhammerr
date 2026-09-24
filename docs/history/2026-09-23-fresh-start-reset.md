# Owner-requested fresh start — 23 September 2026

## Completed scope

The owner explicitly requested removal of all previous application information after the existing registration for their email blocked a fresh signup. An initially considered vendor-only archival operation was **not applied**. The later full-reset request superseded that plan.

The reset was committed to the live application's Supabase project `vouqzekpujgzsplhqqor`. The existing Vercel deployment and website design did not change; no redeploy was needed for a database-only operation.

All data in the 34 explicitly allowlisted parent/application tables was cleared, including their partitions. Removed data included nine user accounts (seven business owners and two admins), seven businesses, five QR codes, two customer records, 11 generated drafts, 106 analytics events, 24 anonymous sessions, 28 login sessions, four reset tokens, seven subscriptions, seven payment records, eight admin audit entries and 52 user activity entries. Business slugs and invoice sequences were reset too. Existing QR codes and sessions no longer work.

One payment was marked captured and had an invoice. Its **application record** was removed under the owner's full-reset instruction; no payment was refunded, charged or cancelled at the payment provider. Provider-held records, external platform logs, the fenced historical Neon source and earlier private backups were not deleted. Supabase-managed `auth.users` and `storage.objects` were already empty and remained empty.

## Minimal clean bootstrap

Ai generation requires an active stored prompt; its `created_by` field has a mandatory user foreign key. To avoid breaking generation configuration while removing every prior identity, the reset created only:

1. A fresh UUID technical identity with a reserved `.invalid` email, unusable password hash, no sessions/MFA, the least-privileged role, and both `disabled_at` and `deleted_at` set. This record cannot log in and is not a vendor or administrator account.
2. A fresh active prompt from the versioned stock `scripts/prompt-versions/1.1.0.json` template. Only the existing deployment-compatible model/reasoning selection was retained as operational configuration; old prompt IDs and history were removed.

All other application tables were empty at the final transaction check. Pricing settings fall back to the existing source defaults: 10 Free drafts, 2,000 Pro drafts per paid period and INR 999 annual price. No plans, auth rules, schemas, service keys or tenant boundaries were redesigned.

There are **zero login-capable accounts and zero admins** as of post-reset verification. A normal fresh signup creates a new business owner, draft business and Free subscription. It does not become an admin automatically. Creating new privileged access needs an explicit follow-up request.

## Recovery and safeguards

The final pre-reset backup is outside the repository, protected by a verified Windows ACL restricted to the current user and SYSTEM:

`C:/Users/digital hammerr/Downloads/ai-review-private-backups/2026-09-23-supabase/target-safety-full-reset-414276cf-66f6-4e60-9370-1103ea23bbe2`

It contains a consistent exported-snapshot PostgreSQL custom archive of `public` and `drizzle`, an SHA-256-checked reset plan, schema/security catalog details, a reference copy of the hardening SQL, and reset verification summaries. Archive contents were listed and fully decoded to the Windows null device without executing SQL. This verifies readability, **not a full restore rehearsal**. The archive excludes ownership/privilege restoration, so any reviewed recovery into a different schema must explicitly reapply the saved security configuration.

These backups retain the old data for recovery; do not upload, commit, display their contents, or restore them automatically. Restoration after new signups could overwrite new customer data and requires a separate reconciliation plan.

The operation used a fixed table allowlist and `TRUNCATE ... RESTART IDENTITY RESTRICT`, not an unbounded `CASCADE`. It rechecked the complete data manifest under table locks before mutation. The mutating transaction used READ COMMITTED so the manifest sees writes committed before lock acquisition; any divergence from the backup would abort. Lock and statement timeouts bounded the operation. Two reset rehearsals rolled back successfully before the committed execution. No user-facing test account was left behind.

Operational helper: ignored `tmp/supabase/reset-application-data.mjs`. **Do not rerun it** or the ordinary demo seed after legitimate signup activity. Its nine-account/seven-business and exact backup-state guards intentionally refuse changed state. If a future operation loses its connection during COMMIT, inspect read-only before assuming rollback or retrying.

## Verification

- All old user UUIDs absent; requested signup email absent from the unique email index.
- Zero login-capable users, admins, businesses, sessions, reset tokens, QR codes, customers and payment records immediately after commit.
- One new non-login configuration record and one active stock prompt; no old identities preserved.
- Signup's user/business/Free-subscription inserts succeeded for the requested email in a savepoint, then rolled back. No production registration or Terms acceptance was performed for the owner.
- Database schema, RLS settings and all eight migration records unchanged; no application tables without RLS.
- Supabase-managed Auth and Storage still empty.
- Live `/`, `/signup` and `/login`: HTTP 200. `/app`: 307 to login. Unauthenticated `/api/v1/business`: 401.

No live Ai generation, payment, refund or email was triggered. Read-only verification is point-in-time: legitimate new signup/activity after completion must be preserved. No broad Redis flush or queue reset was performed; expiring rate-limit counters cannot recreate old accounts or make a freed email duplicate.

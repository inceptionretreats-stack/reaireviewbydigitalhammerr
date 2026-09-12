# Deploying Ai Review to Vercel

The web app (`apps/web`) runs on Vercel; Postgres and Redis come from the Vercel Marketplace
(Neon and Upstash). Deploys are made from a developer machine with the Vercel CLI — nothing is
pushed to a git host. This is the runbook that produced the first deployment
(12 September 2026); repeat only the parts you need.

## What runs where

| Piece                        | Where                                       | Notes                                                                                      |
| ---------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `apps/web` (Next.js)         | Vercel, project `ai-review-dh`              | Root Directory `apps/web`, Node 24.x, functions in `sin1`. `apps/web/vercel.json`.         |
| Postgres                     | Neon via Marketplace (`ai-review-db`)       | Free plan, `aws-ap-southeast-1`. App uses the pooled `DATABASE_URL`; scripts the unpooled. |
| Redis (rate limits)          | Upstash via Marketplace (`ai-review-redis`) | Free plan. `REDIS_URL` is the `rediss://` string.                                          |
| `apps/worker` (BullMQ crons) | **not deployed**                            | Analytics daily rollup, partition maintenance, session purge. See "Not running".           |
| Outbound email               | **not configured**                          | Production transport is `UnconfiguredMailTransport`; forgot-password sends nothing.        |

## One-time setup (already done)

1. `vercel project add ai-review-dh` · `vercel link --project ai-review-dh --yes` (repo root;
   writes `.vercel/`, git-ignored).
2. Root Directory, Node version and framework are project settings the CLI cannot set
   non-interactively; they were set with `PATCH https://api.vercel.com/v9/projects/<id>`
   (`{"rootDirectory":"apps/web","nodeVersion":"24.x","framework":"nextjs"}`) using the CLI's own
   session token from `%APPDATA%\xdg.data\com.vercel.cli\auth.json`.
3. Marketplace storage — each needs a one-time human click on the terms page the CLI prints:
   `vercel integration add neon -n ai-review-db -e production` and
   `vercel integration add upstash/upstash-kv -n ai-review-redis -e production`.
4. Environment (`vercel env add NAME production --value … [--sensitive] --force`):
   `APP_BASE_URL`, `API_BASE_URL` (= base + `/api/v1`), `SESSION_SECRET`, `APP_ENCRYPTION_KEY`,
   `HASH_PEPPER` (fresh random values, never the dev ones), `DATABASE_POOL_MIN=0`,
   `DATABASE_POOL_MAX=5`, `DATABASE_SSL=require`, `S3_BUCKET=unused` (schema requires it; nothing
   reads it), `EMAIL_FROM`, `GEMINI_API_KEY`, `AI_REQUEST_TIMEOUT_MS=12000`,
   `AI_DEFAULT_MODEL=gemini-3.5-flash-lite`, `LOG_LEVEL=info`. `DATABASE_URL*` and `REDIS_URL`
   are injected by the integrations. Razorpay keys are added the same way when they exist.
5. Database bring-up from this machine, against the **unpooled** URL
   (`vercel env pull .vercel/.env.production.local --environment production` to get it):
   - `DATABASE_URL=<unpooled> pnpm db:migrate`
   - `DATABASE_URL=<unpooled> HASH_PEPPER=<prod pepper> AI_DEFAULT_MODEL=gemini-3.5-flash-lite SEED_OWNER_PASSWORD=<random> pnpm seed`
     (leave `NODE_ENV` unset — the seed and `create-admin` refuse when their own process says
     production; the target being a production database is fine and intended)
   - `DATABASE_URL=<unpooled> HASH_PEPPER=<prod pepper> node node_modules/tsx/dist/cli.mjs scripts/create-admin.mjs --email … --password … --name … --reason …`

## Deploying a change

```
pnpm --filter @ai-review/web build     # catch build errors locally first
vercel deploy --prod --yes             # from the repo root
```

A new migration: run `pnpm db:migrate` against the unpooled URL **before** deploying the code
that needs it. `vercel inspect <deployment-url> --logs` shows a failed build.

## Rotating a secret

`vercel env add NAME production --value <new> --sensitive --force`, then redeploy. Rotating
`HASH_PEPPER` invalidates every stored password; rotating `SESSION_SECRET` signs everyone out.

## Not running on Vercel, and what that means

- **Worker.** The analytics trend shows completed days as "pending" until a rollup exists;
  today/range figures are computed live. Sessions expire by timestamp regardless of the purge.
  `analytics_events` has monthly partitions two months ahead plus a DEFAULT catch-all, so inserts
  never fail. A Vercel Cron route can take over the rollup when needed.
- **Email.** Password reset returns 202 and sends nothing. Wire Resend/SES into
  `apps/web/lib/mailer.ts` before relying on it.
- **Admin MFA** is not built (19_Admin_Panel_Spec makes it mandatory); the production admin is
  password-only and rate-limited.
- **Vercel Hobby** is licensed for personal, non-commercial use. Move to Pro (or another host)
  before charging businesses.
- **Free-tier cold starts.** Neon suspends compute after 5 idle minutes; the first request after
  that pays a second or two.

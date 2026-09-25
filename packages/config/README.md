# @ai-review/config — environment schema

This package validates the process environment once, at boot, so a missing or malformed secret
stops the app from starting instead of failing on a customer request. Read it when you add,
rename or change the rules for an environment variable. For what each variable means and where
to set it, see [docs/operations/environment.md](../../docs/operations/environment.md).

## What it provides

Everything lives in `src/env.ts` and is re-exported from `src/index.ts`.

| Export               | What it is                                                                               |
| -------------------- | ---------------------------------------------------------------------------------------- |
| `envSchema`          | The Zod schema: every variable, its type, default and cross-field rules.                 |
| `Env`                | The parsed, typed result (`z.infer<typeof envSchema>`).                                  |
| `loadEnv(source?)`   | Parses `process.env` (or `source`) and returns `Env`. Throws on any problem.             |
| `EnvValidationError` | Thrown by `loadEnv`; `issues` lists every failing variable at once, not one per restart. |

Things the schema does beyond type checks:

- **Empty means unset** for optional secrets, so `KEY=` in `.env` behaves like a missing key.
- **Secrets** must be at least 16 characters and must not start with `CHANGE_ME`;
  `APP_ENCRYPTION_KEY` needs at least 32.
- **URLs:** `APP_BASE_URL` must be a bare origin; `API_BASE_URL` must be that origin plus exactly
  `/api/v1`; `CSRF_TRUSTED_ORIGINS` is a comma list of exact origins.
- **Production-only rules** (`NODE_ENV=production`): at least one of `ANTHROPIC_API_KEY`,
  `OPENAI_API_KEY` or `GEMINI_API_KEY` (otherwise the stub provider would serve canned drafts),
  `CRON_SECRET` set, `APP_BASE_URL` on HTTPS with a public host (it is printed into every QR code),
  and HTTPS public hosts in `CSRF_TRUSTED_ORIGINS`.
- **Validated but not read:** `FREE_AI_GENERATION_LIMIT`, `PRO_ANNUAL_GENERATION_LIMIT` and
  `PRO_ANNUAL_PRICE_PAISE` are accepted because the frozen spec lists them, but no code reads
  them. The draft allowances and the Pro price come from the `platform_settings` table, falling
  back to `PLATFORM_SETTING_DEFAULTS` in `packages/core/src/platform/settings.ts`.

## Who uses it

- `apps/web/lib/infra/env.ts` — `env()` calls `loadEnv()` once per process and caches it. It is
  server-only, which keeps provider keys and payment secrets out of the browser bundle.
- `apps/worker/src/config.ts` — `loadWorkerConfig()` calls `loadEnv()` and then parses its own
  `WORKER_*` variables with a separate schema.

Some variables are read directly by the tool that needs them and are **not** in this schema:
`DIRECT_DATABASE_URL` (migrations, `packages/db`), `WORKER_*` (the worker; the deployed
maintenance cron in `apps/web/lib/cron/maintenance-store.ts` also reads
`WORKER_PARTITION_MONTHS_AHEAD` and `WORKER_SESSION_PURGE_GRACE_DAYS`), `SEED_*`,
`AI_DEFAULT_MODEL` and `AI_REASONING_EFFORT_OVERRIDE` (`scripts/db/seed.ts`, which deliberately
does not call `loadEnv`), `MIGRATION_MAINTENANCE` (`apps/web/lib/infra/migration-maintenance.ts`)
and the `E2E_*` test variables.

## Changing the schema

1. Edit `src/env.ts`. Keep optional things optional, with a safe default where possible, so an
   existing deployment does not fail to boot.
2. Add the name (never a real value) to the root `.env.example`.
3. Update `src/__tests__/env.test.ts` and the operations environment doc.

The schema mirrors the frozen `docs/spec/15_Environment_Variables.example`; a variable that
changes that contract should be recorded in
[`docs/decisions/spec-amendments.md`](../../docs/decisions/spec-amendments.md).

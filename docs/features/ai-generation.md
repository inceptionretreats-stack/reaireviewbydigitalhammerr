# Ai generation

This document explains how a customer's editable Ai draft is produced: the request pipeline, where
the prompt and model come from, what the owner can influence (services, context, review modes, draft
language), how draft allowances are reserved and returned, which Ai provider is used, and the quality
checks every draft must pass. Read it before changing prompts, providers, quotas or anything in
`packages/core/src/ai/`. The customer-facing side is in
[customer review flow](customer-review-flow.md).

## The pipeline

`POST /api/v1/public/review/generate` (`apps/web/app/api/v1/public/review/generate/route.ts`) runs
these steps in order. Anything that refuses a request does so before the expensive parts.

1. **Parse** the body with Zod: `slug`, `qr_code`, optional `previous_generation_id` (a UUID) and
   `selected_services`.
2. **Resolve the business** from the QR code (preferred) or slug on the server
   (`apps/web/lib/customer/resolve-public-ref.ts`). A disabled QR answers `QR_DISABLED`; a missing and
   a suspended business both answer `RESOURCE_NOT_FOUND`.
3. **Anonymous session** for this browser and business, if the cookie is present.
4. **Admin Ai controls.** If an admin has switched Ai off for the business, answer `AI_SUSPENDED`
   with the same wording as a provider outage.
5. **Load the generation context** (`loadGenerationContext` in `apps/web/lib/ai/generation-service.ts`):
   the single ACTIVE prompt version, business name, category, city and description, the owner's
   services and context terms, the draft language and the active review mode.
6. **Validate the selected services** against this business's current list
   (`apps/web/lib/customer/customer-services.ts`); `422` if they do not match.
7. **Rate limit** (session burst and hourly, network prefix, admin throttle, Pro fair-use
   observation). See [security](../architecture/security.md#rate-limiting).
8. **Previous drafts**: up to three recent drafts from this session, for variation.
9. **Choose the provider** and run `ReviewGenerator.generate` (`packages/core/src/ai/generator.ts`):
   reserve one draft of allowance, attempt generation, then commit or release the reservation.
10. **Save** the draft to `ai_generations`. If saving fails, the reservation is handed back
    (`releaseQuota`) and the customer gets `INTERNAL_ERROR`.
11. **Record** `ai_generate_success` (or `ai_generate_failure` at any failing step) and return
    `generation_id`, `review_text`, `prompt_version`, the services used and
    `requires_experience_confirmation: true`.

Route budget: `maxDuration = 60` for Vercel. The browser retries once on a 503 after about 1.5 s;
that retry is separate from the generator's internal attempts.

## Prompt versions

The model, reasoning effort, output token cap, system prompt, writing rules and output schema live in
the database, in `ai_prompt_versions`, so quality changes are data changes with rollback rather than
deploys.

- Status is `DRAFT`, `ACTIVE` or `ARCHIVED`; exactly one row is ACTIVE platform-wide. ACTIVE and
  ARCHIVED rows are immutable because every generation stores the `prompt_version_id` it used.
- Changing the live prompt means: create a draft (usually a clone of the active version) in
  `/admin/ai`, edit it, activate it. Activation archives the previous ACTIVE row in the same
  transaction. Activating an archived row is a rollback and is audited as one. Code:
  `packages/core/src/ai/prompt-version-service.ts`, admin API under
  `/api/v1/admin/ai/prompt-versions`.
- The writing rules are the `guidance` JSON on the row (`packages/core/src/ai/guidance.ts`): language
  rules per draft language, claim rules, emoji rules, and rotating opening hints and emoji
  placements. `DEFAULT_GUIDANCE` is the fallback for an empty or damaged column.
- **Seeding.** `scripts/db/seed.ts` loads version 1.0.0 from the frozen
  `docs/spec/10_AI_Prompt_Templates.json` as ARCHIVED history and the current version from
  `scripts/db/prompt-versions/1.1.0.json` (`CURRENT_PROMPT_VERSION`). New versions after 1.0.0 go in
  that folder, never in `docs/spec`. At seed time `AI_DEFAULT_MODEL` and
  `AI_REASONING_EFFORT_OVERRIDE` can override the file's model and effort.
- **Switching the model.** `pnpm ai:model <model-id>` (`scripts/ops/set-ai-model.mjs`) changes the
  ACTIVE row's model immediately against whatever `DATABASE_URL` points at; `pnpm ai:model --show` is
  read-only. The model id must be one the configured provider accepts.
- `OPENAI_DEFAULT_MODEL`, `OPENAI_FALLBACK_MODEL`, `OPENAI_REASONING_EFFORT` and
  `AI_MAX_OUTPUT_TOKENS` are accepted by the configuration schema but do not change the running
  model; the ACTIVE row decides.

## What the owner controls

All of it is context for the model, never mandatory wording. There is deliberately no "required
keywords" setting.

| Setting           | Where it is edited                     | Stored in                                | Effect on the prompt                                                               |
| ----------------- | -------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------- |
| Services          | `/onboarding/ai`, `/app/ai-review`     | `ai_business_contexts.services`          | The customer picks from these; with a selection, only the picked services are sent |
| Context terms     | same                                   | `ai_business_contexts.context_terms`     | Hints; dropped when the customer selected services                                 |
| Draft language    | same                                   | `ai_business_contexts.draft_language`    | `hinglish` (default; Hindi in Roman script mixed with English) or `en`             |
| Business summary  | same                                   | `ai_business_contexts.summary`           | Stored and shown to admins, but **not sent to the model** today                    |
| Short description | `/onboarding/business`, `/app/profile` | `businesses.description`                 | Sent, unless the customer selected services                                        |
| Review mode       | `/app/review-modes`                    | `review_modes` (one active per business) | A named emphasis with its own terms; dropped when services are selected            |

The first save of the Ai context creates a "Balanced" mode with no extra terms, so every business has
an active mode. A review mode changes emphasis only; it never sets tone, sentiment or a rating.

When the customer has selected services, `buildPrompt` (`packages/core/src/ai/prompt-builder.ts`)
sends only the business name, city and the selected services, adds rules that the selection is not
evidence of satisfaction or outcomes and that every supplied value is untrusted data, and omits emoji
guidance. Business data is always passed as JSON values, never spliced into instructions.

## Draft allowances and atomic reservation

Allowances belong to a business, on its `subscriptions` row. Free drafts are a lifetime allowance
(`free_generations_used` / `free_generation_limit`); Pro drafts are per paid period
(`pro_generations_used` / `pro_generation_limit`), reset when a new period starts. When a Pro period
has ended, the business falls back to any unused Free allowance. A business that is not `ACTIVE`
cannot generate. Plan terms: [billing and plans](billing-and-plans.md).

`PostgresQuotaStore.tryConsume` (`packages/core/src/quota/postgres-store.ts`) reserves a draft with a
**single conditional `UPDATE`** that increments the counter only while it is below the limit and the
business is active, so concurrent requests cannot overspend. The reservation is taken **before** the
provider call and released (decremented) if the provider fails, every attempt is rejected, or the
draft cannot be saved. Up to three internal attempts share one reservation, so they cost the business
one draft. Editing, copying, opening Google and returning to a saved draft cost nothing; "New review"
costs one draft.

The owner's preview (`POST /api/v1/ai/test-preview`) calls the provider directly without touching
the allowance. It still runs the compliance check, writes no `ai_generations` row, and is limited to
3 per 30 seconds and 20 per hour per business.

If the process dies between the reservation and the save, one draft can still be lost; see
[known issues](../known-issues.md).

## Providers

`selectProvider` in `apps/web/lib/ai/generation-service.ts` picks by which key is set:
`ANTHROPIC_API_KEY`, then `OPENAI_API_KEY`, then `GEMINI_API_KEY`. With none, a deterministic stub
answers (local development and CI only; production configuration fails without a key). There is no
automatic failover to another provider or model. `AI_REQUEST_TIMEOUT_MS` (default 8,000 ms) is the
budget for the whole generation, not each attempt. Adapters: `packages/core/src/ai/*-provider.ts`;
their output is validated by `packages/core/src/ai/structured-review.ts`. Provider failures are
logged without keys and reach the customer as `AI_PROVIDER_UNAVAILABLE`.

## Quality gates

Every candidate customer draft is checked in `generator.ts` (the owner preview makes one provider
call and applies only the compliance check):

- **Compliance** (`checkOutputCompliance`): 80–1,200 characters; no stated rating (words, numbers,
  star emoji, Hinglish forms); no extreme praise; no incentives or discounts; no unsupported specific
  claims such as durations, prices or percentages.
- **Service scope** (`mentionsUnselectedService`): must not name a configured service the customer
  did not select.
- **Variation** (`packages/core/src/ai/similarity.ts`): character-trigram similarity to each of the
  session's last three drafts must stay under 0.45.

A failed attempt is retried with the rejection reasons named in the prompt, up to three attempts, and
only while at least 1.5 s of the budget remains. If none passes, the reservation is released and the
customer gets `AI_OUTPUT_REJECTED`.

## Where the code lives

| What                                | Path                                                                                                              |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Public endpoint                     | `apps/web/app/api/v1/public/review/generate/route.ts`                                                             |
| Context loading, provider choice    | `apps/web/lib/ai/generation-service.ts`                                                                           |
| Draft-language options              | `apps/web/lib/ai/draft-language.ts`, `packages/core/src/ai/draft-language.ts`                                     |
| Review modes                        | `apps/web/lib/ai/modes/`, `apps/web/app/api/v1/ai/modes/`                                                         |
| Owner context and preview           | `apps/web/app/api/v1/ai/context/route.ts`, `apps/web/app/api/v1/ai/test-preview/`                                 |
| Owner Ai screens                    | `apps/web/components/dashboard/ai-review/`, `apps/web/components/onboarding/AiContextStep.tsx`                    |
| Generator, prompt builder, guidance | `packages/core/src/ai/generator.ts`, `packages/core/src/ai/prompt-builder.ts`, `packages/core/src/ai/guidance.ts` |
| Prompt version lifecycle            | `packages/core/src/ai/prompt-version-service.ts`, `apps/web/components/admin/PromptVersionEditor.tsx`             |
| Quota                               | `packages/core/src/quota/`                                                                                        |
| Seeded prompt versions              | `scripts/db/prompt-versions/`, `scripts/db/seed.ts`                                                               |
| Model switch tool                   | `scripts/ops/set-ai-model.mjs`                                                                                    |

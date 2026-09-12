import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { aiPromptStatus, draftLanguage } from './enums';
import { businesses } from './business';
import { users } from './identity';
import { anonymousSessions, qrCodes } from './qr';

/** Merchant business context — hints for the model, never mandatory output (D-025, AC-010). */
export const aiBusinessContexts = pgTable('ai_business_contexts', {
  businessId: uuid('business_id')
    .primaryKey()
    .references(() => businesses.id, { onDelete: 'cascade' }),
  summary: text('summary'),
  services: jsonb('services').notNull().default([]),
  contextTerms: jsonb('context_terms').notNull().default([]),
  /** CHANGE-003. A business with no context row at all is Hinglish too — see loadGenerationContext. */
  draftLanguage: draftLanguage('draft_language').notNull().default('hinglish'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid('updated_by').references(() => users.id),
});

/** A review mode shifts context emphasis only — never sentiment or rating (D-025, glossary). */
export const reviewModes = pgTable(
  'review_modes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 80 }).notNull(),
    description: varchar('description', { length: 500 }),
    contextTerms: jsonb('context_terms').notNull().default([]),
    isActive: boolean('is_active').notNull().default(false),
    isArchived: boolean('is_archived').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_review_mode_name').on(t.businessId, t.name),
    // AI-02-01 and AI-02-02: exactly one active mode, and an archived mode cannot be it.
    uniqueIndex('uq_one_active_mode')
      .on(t.businessId)
      .where(sql`is_active AND NOT is_archived`),
  ],
);

/**
 * Admin-managed prompt/model configuration (ADR-006, ADMIN-03).
 *
 * Lives in data rather than source so AI quality can be rolled back without an application
 * deploy (ADMIN-03-03), and so every generation can name the exact version that produced it.
 * Business owners must never be able to reach these rows (AI-01-02).
 */
export const aiPromptVersions = pgTable(
  'ai_prompt_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    version: varchar('version', { length: 40 }).notNull().unique(),
    status: aiPromptStatus('status').notNull().default('DRAFT'),
    model: varchar('model', { length: 80 }).notNull(),
    reasoningEffort: varchar('reasoning_effort', { length: 20 }).notNull().default('none'),
    systemPrompt: text('system_prompt').notNull(),
    outputSchema: jsonb('output_schema').notNull(),
    maxOutputTokens: integer('max_output_tokens').notNull().default(220),
    /**
     * The writing rules that used to be constants in prompt-builder.ts: language rules, claim
     * rules, emoji rules, opening angles, emoji placements. Data, so an admin can change how
     * drafts read without a deploy (ADR-006, ADMIN-03). Shape: PromptGuidance in core.
     */
    guidance: jsonb('guidance').notNull().default({}),
    rolloutPercent: integer('rollout_percent').notNull().default(100),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    activatedAt: timestamp('activated_at', { withTimezone: true }),
  },
  (t) => [
    check('ck_rollout_percent', sql`rollout_percent BETWEEN 0 AND 100`),
    // AMENDMENT-010 — ADMIN-03-01 requires exactly one active production version, but the
    // original schema also carried rollout_percent with no stated rule for what serves the
    // remainder at, say, 50%. Resolution: at most one ACTIVE row is the default; a partial
    // rollout splits against the most recently archived version as control. The constraint
    // below makes the "only one active" half enforceable rather than conventional.
    uniqueIndex('uq_one_active_prompt_version')
      .on(t.status)
      .where(sql`status = 'ACTIVE'`),
  ],
);

/**
 * One stored draft. Regeneration chains via parentGenerationId (Flow D).
 *
 * countedTowardQuota records the decision made at generation time rather than recomputing it
 * later: provider failures and owner previews do not count, an internal quality-gate retry counts
 * once, and a successful customer generation counts on both Free and Pro.
 */
export const aiGenerations = pgTable(
  'ai_generations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    anonymousSessionId: uuid('anonymous_session_id').references(() => anonymousSessions.id, {
      onDelete: 'set null',
    }),
    qrCodeId: uuid('qr_code_id').references(() => qrCodes.id, { onDelete: 'set null' }),
    reviewModeId: uuid('review_mode_id').references(() => reviewModes.id, {
      onDelete: 'set null',
    }),
    parentGenerationId: uuid('parent_generation_id').references(
      (): AnyPgColumn => aiGenerations.id,
      { onDelete: 'set null' },
    ),
    promptVersionId: uuid('prompt_version_id')
      .notNull()
      .references(() => aiPromptVersions.id),
    model: varchar('model', { length: 80 }).notNull(),
    generationNumber: integer('generation_number').notNull().default(1),
    reviewText: text('review_text').notNull(),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    providerRequestId: varchar('provider_request_id', { length: 160 }),
    similarityScore: numeric('similarity_score', { precision: 5, scale: 4 }),
    moderationFlags: jsonb('moderation_flags').notNull().default({}),
    countedTowardQuota: boolean('counted_toward_quota').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_ai_gen_business_created').on(t.businessId, t.createdAt.desc()),
    index('idx_ai_gen_session').on(t.anonymousSessionId, t.createdAt),
  ],
);

export type AiBusinessContext = typeof aiBusinessContexts.$inferSelect;
export type ReviewMode = typeof reviewModes.$inferSelect;
export type AiPromptVersion = typeof aiPromptVersions.$inferSelect;
export type AiGeneration = typeof aiGenerations.$inferSelect;

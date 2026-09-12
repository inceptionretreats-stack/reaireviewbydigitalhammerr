import { desc, eq } from 'drizzle-orm';
import { aiPromptVersions, type AiPromptVersion, type Database } from '@ai-review/db';
import { AuditWriter } from '../audit/writer';
import type { Executor } from '../db-executor';
import { parseGuidance, type PromptGuidance } from './guidance';

/**
 * Prompt versions as an admin-managed object (ADMIN-03, E4-08, ADR-006).
 *
 * The seed and `set-ai-model.mjs` were the only writers of `ai_prompt_versions`; neither runs
 * in production, so the rollback ADR-006 promises did not exist there. This is the writer both
 * the admin screen and any future script sit on.
 *
 * The lifecycle is the spec's three states. A DRAFT is editable; ACTIVE and ARCHIVED are not —
 * a version that has written drafts must keep saying what it said when it wrote them, because
 * every generation stores its prompt_version_id and that pointer is only worth anything if the
 * row is immutable. Changing a live prompt means: clone to a draft, edit, activate. Activation
 * archives the current ACTIVE row in the same transaction, which is what keeps
 * `uq_one_active_prompt_version` satisfied; activating an ARCHIVED row is a rollback and is
 * audited under that name.
 */

export interface PromptVersionActor {
  userId: string;
  ipHash?: string | null;
}

export interface PromptVersionFields {
  version: string;
  model: string;
  reasoningEffort: string;
  maxOutputTokens: number;
  systemPrompt: string;
  guidance: PromptGuidance;
  outputSchema: Record<string, unknown>;
}

export class PromptVersionError extends Error {
  constructor(
    readonly code:
      'NOT_FOUND' | 'NOT_A_DRAFT' | 'VERSION_TAKEN' | 'ALREADY_ACTIVE' | 'IS_ACTIVE' | 'INVALID',
    message: string,
  ) {
    super(message);
    this.name = 'PromptVersionError';
  }
}

const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

export class PromptVersionService {
  constructor(private readonly db: Database) {}

  async list(): Promise<AiPromptVersion[]> {
    return this.db.select().from(aiPromptVersions).orderBy(desc(aiPromptVersions.createdAt));
  }

  async get(id: string): Promise<AiPromptVersion | null> {
    const [row] = await this.db
      .select()
      .from(aiPromptVersions)
      .where(eq(aiPromptVersions.id, id))
      .limit(1);
    return row ?? null;
  }

  /**
   * A new DRAFT. Usually a clone of the active version with a new version string, which is the
   * "Clone version" action the spec lists and the only sane starting point for an edit.
   */
  async createDraft(input: {
    actor: PromptVersionActor;
    fields: PromptVersionFields;
  }): Promise<AiPromptVersion> {
    const fields = normalise(input.fields);
    return this.db.transaction(async (tx) => {
      const [taken] = await tx
        .select({ id: aiPromptVersions.id })
        .from(aiPromptVersions)
        .where(eq(aiPromptVersions.version, fields.version))
        .limit(1);
      if (taken) throw new PromptVersionError('VERSION_TAKEN', `version ${fields.version} exists`);

      const [row] = await tx
        .insert(aiPromptVersions)
        .values({
          version: fields.version,
          status: 'DRAFT',
          model: fields.model,
          reasoningEffort: fields.reasoningEffort,
          systemPrompt: fields.systemPrompt,
          outputSchema: fields.outputSchema,
          guidance: fields.guidance,
          maxOutputTokens: fields.maxOutputTokens,
          rolloutPercent: 0,
          createdBy: input.actor.userId,
          activatedAt: null,
        })
        .returning();
      await new AuditWriter(tx).record({
        actorUserId: input.actor.userId,
        ipHash: input.actor.ipHash ?? null,
        action: 'prompt_version.create',
        targetType: 'prompt_version',
        targetId: row!.id,
        after: auditView(row!),
      });
      return row!;
    });
  }

  /** Edits a DRAFT. Anything else is immutable — see the module comment. */
  async updateDraft(
    id: string,
    input: { actor: PromptVersionActor; fields: Partial<PromptVersionFields> },
  ): Promise<AiPromptVersion> {
    return this.db.transaction(async (tx) => {
      const before = await lockRow(tx, id);
      if (before.status !== 'DRAFT') {
        throw new PromptVersionError(
          'NOT_A_DRAFT',
          `version ${before.version} is ${before.status}`,
        );
      }
      const merged = normalise({
        version: input.fields.version ?? before.version,
        model: input.fields.model ?? before.model,
        reasoningEffort: input.fields.reasoningEffort ?? before.reasoningEffort,
        maxOutputTokens: input.fields.maxOutputTokens ?? before.maxOutputTokens,
        systemPrompt: input.fields.systemPrompt ?? before.systemPrompt,
        guidance: input.fields.guidance ?? parseGuidance(before.guidance),
        outputSchema: input.fields.outputSchema ?? (before.outputSchema as Record<string, unknown>),
      });
      if (merged.version !== before.version) {
        const [taken] = await tx
          .select({ id: aiPromptVersions.id })
          .from(aiPromptVersions)
          .where(eq(aiPromptVersions.version, merged.version))
          .limit(1);
        if (taken)
          throw new PromptVersionError('VERSION_TAKEN', `version ${merged.version} exists`);
      }
      const [after] = await tx
        .update(aiPromptVersions)
        .set({
          version: merged.version,
          model: merged.model,
          reasoningEffort: merged.reasoningEffort,
          systemPrompt: merged.systemPrompt,
          outputSchema: merged.outputSchema,
          guidance: merged.guidance,
          maxOutputTokens: merged.maxOutputTokens,
        })
        .where(eq(aiPromptVersions.id, id))
        .returning();
      await new AuditWriter(tx).record({
        actorUserId: input.actor.userId,
        ipHash: input.actor.ipHash ?? null,
        action: 'prompt_version.update',
        targetType: 'prompt_version',
        targetId: id,
        before: auditView(before),
        after: auditView(after!),
      });
      return after!;
    });
  }

  /**
   * Makes `id` the one ACTIVE version. The current one becomes ARCHIVED in the same
   * transaction; a re-activation of an ARCHIVED row is recorded as a rollback.
   */
  async activate(
    id: string,
    input: { actor: PromptVersionActor; reason: string },
  ): Promise<AiPromptVersion> {
    return this.db.transaction(async (tx) => {
      const target = await lockRow(tx, id);
      if (target.status === 'ACTIVE') {
        throw new PromptVersionError(
          'ALREADY_ACTIVE',
          `version ${target.version} is already active`,
        );
      }
      const isRollback = target.status === 'ARCHIVED';
      const now = new Date();

      const [current] = await tx
        .select()
        .from(aiPromptVersions)
        .where(eq(aiPromptVersions.status, 'ACTIVE'))
        .for('update')
        .limit(1);
      if (current) {
        await tx
          .update(aiPromptVersions)
          .set({ status: 'ARCHIVED', rolloutPercent: 0 })
          .where(eq(aiPromptVersions.id, current.id));
      }
      const [after] = await tx
        .update(aiPromptVersions)
        .set({ status: 'ACTIVE', rolloutPercent: 100, activatedAt: now })
        .where(eq(aiPromptVersions.id, id))
        .returning();

      await new AuditWriter(tx).record({
        actorUserId: input.actor.userId,
        ipHash: input.actor.ipHash ?? null,
        action: isRollback ? 'prompt_version.rollback' : 'prompt_version.activate',
        targetType: 'prompt_version',
        targetId: id,
        reason: input.reason,
        before: { active: current ? auditView(current) : null, target: auditView(target) },
        after: { active: auditView(after!) },
      });
      return after!;
    });
  }

  /** Retires a DRAFT or a previously active version. The ACTIVE one cannot be archived directly. */
  async archive(
    id: string,
    input: { actor: PromptVersionActor; reason: string },
  ): Promise<AiPromptVersion> {
    return this.db.transaction(async (tx) => {
      const before = await lockRow(tx, id);
      if (before.status === 'ACTIVE') {
        throw new PromptVersionError('IS_ACTIVE', 'activate another version first');
      }
      const [after] = await tx
        .update(aiPromptVersions)
        .set({ status: 'ARCHIVED', rolloutPercent: 0 })
        .where(eq(aiPromptVersions.id, id))
        .returning();
      await new AuditWriter(tx).record({
        actorUserId: input.actor.userId,
        ipHash: input.actor.ipHash ?? null,
        action: 'prompt_version.archive',
        targetType: 'prompt_version',
        targetId: id,
        reason: input.reason,
        before: auditView(before),
        after: auditView(after!),
      });
      return after!;
    });
  }
}

async function lockRow(tx: Executor, id: string): Promise<AiPromptVersion> {
  const [row] = await tx
    .select()
    .from(aiPromptVersions)
    .where(eq(aiPromptVersions.id, id))
    .for('update')
    .limit(1);
  if (!row) throw new PromptVersionError('NOT_FOUND', 'no such prompt version');
  return row;
}

function normalise(fields: PromptVersionFields): PromptVersionFields {
  const version = fields.version.trim();
  if (!VERSION_PATTERN.test(version)) {
    throw new PromptVersionError('INVALID', 'version must look like 1.2.0');
  }
  const model = fields.model.trim();
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(model)) {
    throw new PromptVersionError('INVALID', 'model must be a plain model id');
  }
  const maxOutputTokens = fields.maxOutputTokens;
  if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 64 || maxOutputTokens > 4096) {
    throw new PromptVersionError('INVALID', 'max output tokens must be 64 to 4096');
  }
  const systemPrompt = fields.systemPrompt.trim();
  if (systemPrompt.length < 40 || systemPrompt.length > 20_000) {
    throw new PromptVersionError('INVALID', 'system prompt must be 40 to 20000 characters');
  }
  return {
    version,
    model,
    reasoningEffort: fields.reasoningEffort.trim().slice(0, 20),
    maxOutputTokens,
    systemPrompt,
    guidance: parseGuidance(fields.guidance),
    outputSchema: fields.outputSchema,
  };
}

/** What an audit row keeps: the knobs, and a hash of the long text so a change is visible. */
function auditView(row: AiPromptVersion) {
  return {
    version: row.version,
    status: row.status,
    model: row.model,
    reasoning_effort: row.reasoningEffort,
    max_output_tokens: row.maxOutputTokens,
    rollout_percent: row.rolloutPercent,
    system_prompt_length: row.systemPrompt.length,
    guidance: row.guidance,
  };
}

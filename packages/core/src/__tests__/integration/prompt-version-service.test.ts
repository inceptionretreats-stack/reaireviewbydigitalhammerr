import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '@ai-review/db';
import { AuditReasonRequiredError } from '../../audit/writer';
import { DEFAULT_GUIDANCE } from '../../ai/guidance';
import { PromptVersionService } from '../../ai/prompt-version-service';

/**
 * The prompt-version lifecycle against the real partial unique index. A mocked store cannot
 * prove that "activate" leaves exactly one ACTIVE row, and that is the whole point of it.
 *
 * Runs against the shared dev database, so it works around whatever is active: it creates its
 * own drafts, activates them, and finishes by re-activating what it found — every step through
 * the service, which is also a test of rollback.
 */
describe('PromptVersionService', () => {
  let pool: Pool;
  let db: Database;
  let adminId: string;
  let originalActiveId: string | null = null;
  const created: string[] = [];
  const actor = () => ({ userId: adminId, ipHash: null });
  const suffix = randomUUID().slice(0, 8);

  beforeAll(async () => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is required for the integration suite.');
    pool = new Pool({ connectionString: url, max: 4 });
    db = createDatabase({ connectionString: url, poolMax: 4 });
    adminId = randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, full_name, password_hash, role)
       VALUES ($1, $2, 'Prompt Admin', 'x', 'SUPER_ADMIN')`,
      [adminId, `pvsvc-${adminId}@example.test`],
    );
    const { rows } = await pool.query(`SELECT id FROM ai_prompt_versions WHERE status = 'ACTIVE'`);
    originalActiveId = rows[0]?.id ?? null;
  });

  afterAll(async () => {
    if (originalActiveId) {
      await new PromptVersionService(db)
        .activate(originalActiveId, { actor: actor(), reason: 'test teardown: restore' })
        .catch(() => undefined);
    }
    await pool.query('DELETE FROM admin_audit_logs WHERE actor_user_id = $1', [adminId]);
    if (created.length) {
      await pool.query('DELETE FROM ai_prompt_versions WHERE id = ANY($1::uuid[])', [created]);
    }
    await pool.query('DELETE FROM users WHERE id = $1', [adminId]);
    await pool.end();
  });

  const fields = (version: string) => ({
    version,
    model: 'gemini-3.5-flash-lite',
    reasoningEffort: 'none',
    maxOutputTokens: 320,
    systemPrompt:
      'You are an AI review-writing assistant. Produce one editable draft for a real customer.',
    guidance: { ...DEFAULT_GUIDANCE, opening_hints: ['Open with the chai.'] },
    outputSchema: { type: 'object' },
  });

  it('creates a draft, edits it, and refuses to edit anything that is not a draft', async () => {
    const service = new PromptVersionService(db);
    const draft = await service.createDraft({ actor: actor(), fields: fields(`9.0.0-${suffix}`) });
    created.push(draft.id);
    expect(draft.status).toBe('DRAFT');
    expect(draft.rolloutPercent).toBe(0);
    expect((draft.guidance as { opening_hints: string[] }).opening_hints).toEqual([
      'Open with the chai.',
    ]);

    const edited = await service.updateDraft(draft.id, {
      actor: actor(),
      fields: { maxOutputTokens: 400, guidance: { ...DEFAULT_GUIDANCE, claim_rules: [] } },
    });
    expect(edited.maxOutputTokens).toBe(400);
    expect((edited.guidance as { claim_rules: string[] }).claim_rules).toEqual([]);

    if (originalActiveId) {
      await expect(
        service.updateDraft(originalActiveId, { actor: actor(), fields: { maxOutputTokens: 500 } }),
      ).rejects.toMatchObject({ code: 'NOT_A_DRAFT' });
    }
  });

  it('refuses a duplicate version string and an invalid one', async () => {
    const service = new PromptVersionService(db);
    await expect(
      service.createDraft({ actor: actor(), fields: fields(`9.0.0-${suffix}`) }),
    ).rejects.toMatchObject({ code: 'VERSION_TAKEN' });
    await expect(
      service.createDraft({ actor: actor(), fields: fields('not a version') }),
    ).rejects.toMatchObject({ code: 'INVALID' });
  });

  it('activates a draft, archiving the current version in the same transaction, then rolls back', async () => {
    const service = new PromptVersionService(db);
    const draft = await service.createDraft({ actor: actor(), fields: fields(`9.1.0-${suffix}`) });
    created.push(draft.id);

    await expect(service.activate(draft.id, { actor: actor(), reason: '' })).rejects.toBeInstanceOf(
      AuditReasonRequiredError,
    );

    const active = await service.activate(draft.id, {
      actor: actor(),
      reason: 'Try the new rules',
    });
    expect(active.status).toBe('ACTIVE');
    expect(active.rolloutPercent).toBe(100);
    expect(active.activatedAt).not.toBeNull();

    const { rows } = await pool.query(
      `SELECT id, status FROM ai_prompt_versions WHERE status = 'ACTIVE'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(draft.id);
    if (originalActiveId) {
      const { rows: old } = await pool.query(
        'SELECT status FROM ai_prompt_versions WHERE id = $1',
        [originalActiveId],
      );
      expect(old[0].status).toBe('ARCHIVED');

      // Rollback: activating the archived one again, recorded under that name.
      await service.activate(originalActiveId, { actor: actor(), reason: 'Rules read worse' });
      const { rows: audit } = await pool.query(
        `SELECT action FROM admin_audit_logs WHERE actor_user_id = $1 ORDER BY id DESC LIMIT 1`,
        [adminId],
      );
      expect(audit[0].action).toBe('prompt_version.rollback');
      const { rows: again } = await pool.query(
        `SELECT id FROM ai_prompt_versions WHERE status = 'ACTIVE'`,
      );
      expect(again).toHaveLength(1);
      expect(again[0].id).toBe(originalActiveId);
    }

    await expect(
      service.activate(originalActiveId ?? draft.id, { actor: actor(), reason: 'again' }),
    ).rejects.toMatchObject({ code: 'ALREADY_ACTIVE' });
  });

  it('archives a draft but never the active version', async () => {
    const service = new PromptVersionService(db);
    const draft = await service.createDraft({ actor: actor(), fields: fields(`9.2.0-${suffix}`) });
    created.push(draft.id);
    const archived = await service.archive(draft.id, { actor: actor(), reason: 'Abandoned' });
    expect(archived.status).toBe('ARCHIVED');
    if (originalActiveId) {
      await expect(
        service.archive(originalActiveId, { actor: actor(), reason: 'x' }),
      ).rejects.toMatchObject({ code: 'IS_ACTIVE' });
    }
  });
});

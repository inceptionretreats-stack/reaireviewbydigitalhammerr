import { SQL } from 'drizzle-orm';
import { reviewModes, type Database } from '@ai-review/db';
import { describe, expect, it } from 'vitest';
import {
  MODE_CREATE_LIMIT,
  MODE_LIST_LIMIT,
  createMode,
  isNameCollision,
  updateMode,
} from '../mode-service';

/**
 * The parts of AI-02's storage layer that can be checked without a database.
 *
 * The doubles below stand in for exactly the query shapes `mode-service` builds — a count, an
 * insert, and one update inside a transaction — and record what was passed. That is enough for the
 * two invariants a unit test can hold: a tenant cannot create more modes than `listModes` will
 * return, and a restore cannot bring a mode back active.
 */

const BUSINESS = '11111111-1111-4111-8111-111111111111';
const MODE_ID = '22222222-2222-4222-8222-222222222222';

interface StoredRow {
  id: string;
  name: string;
  description: string | null;
  contextTerms: unknown;
  isActive: boolean;
  isArchived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

function storedRow(overrides: Partial<StoredRow> = {}): StoredRow {
  return {
    id: MODE_ID,
    name: 'Balanced',
    description: null,
    contextTerms: [],
    isActive: false,
    isArchived: false,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

/** A unique violation in the shape node-postgres reports one. */
function uniqueViolation(constraint?: string): Error & { code: string; constraint?: string } {
  return Object.assign(new Error('duplicate key value violates unique constraint'), {
    code: '23505',
    ...(constraint === undefined ? {} : { constraint }),
  });
}

interface CreateDouble {
  db: Database;
  inserted: Record<string, unknown>[];
}

/**
 * `createMode`'s two statements: the ceiling count, then the insert.
 *
 * `insertResult` is either the row the insert returns or the error it raises, which is how the
 * constraint mapping is exercised without a real index.
 */
function createDouble(existingModes: number, insertResult: StoredRow | Error): CreateDouble {
  const inserted: Record<string, unknown>[] = [];

  const db = {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([{ modes: existingModes }]),
      }),
    }),
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        inserted.push(values);
        return {
          returning: () =>
            insertResult instanceof Error
              ? Promise.reject(insertResult)
              : Promise.resolve([insertResult]),
        };
      },
    }),
  };

  return { db: db as unknown as Database, inserted };
}

interface UpdateDouble {
  db: Database;
  /** The SET payload of each UPDATE, in order. The first one is always review_modes. */
  sets: Record<string, unknown>[];
}

/** `updateMode`'s transaction: one update on review_modes, and the config_version bump. */
function updateDouble(row: StoredRow | undefined, error?: Error): UpdateDouble {
  const sets: Record<string, unknown>[] = [];

  const tx = {
    update: () => ({
      set: (values: Record<string, unknown>) => {
        sets.push(values);
        return {
          where: () => ({
            returning: () => {
              if (error !== undefined) return Promise.reject(error);
              return Promise.resolve(row === undefined ? [] : [row]);
            },
          }),
        };
      },
    }),
    select: () => ({
      from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }),
    }),
  };

  const db = {
    transaction: (run: (tx: unknown) => Promise<unknown>) => run(tx),
  };

  return { db: db as unknown as Database, sets };
}

describe('MODE_CREATE_LIMIT', () => {
  it('equals MODE_LIST_LIMIT, so a truncated list is unreachable', () => {
    // The two numbers are load-bearing together: listModes caps its SELECT, and the row it drops
    // first is the newest non-archived one — which activation does not reorder, so it can be the
    // mode in use. /app/ai-review derives "which mode is in use" from that list, so a cap above the
    // list limit would let the screen state that no mode is in use while generation used one.
    expect(MODE_CREATE_LIMIT).toBe(MODE_LIST_LIMIT);
  });
});

describe('createMode', () => {
  it('refuses the create when the tenant is already at the ceiling', async () => {
    const { db, inserted } = createDouble(MODE_CREATE_LIMIT, storedRow());

    const outcome = await createMode(db, BUSINESS, {
      name: 'One too many',
      description: null,
      contextTerms: [],
    });

    expect(outcome).toEqual({ ok: false, reason: 'LIMIT_REACHED' });
    // Refused before the insert, so the row that would have been invisible is never written.
    expect(inserted).toHaveLength(0);
  });

  it('creates the mode inactive when the tenant is one below the ceiling', async () => {
    const { db, inserted } = createDouble(MODE_CREATE_LIMIT - 1, storedRow({ name: 'Dinner' }));

    const outcome = await createMode(db, BUSINESS, {
      name: 'Dinner',
      description: null,
      contextTerms: ['tasting menu'],
    });

    expect(outcome.ok).toBe(true);
    expect(inserted).toHaveLength(1);
    // AI-02-01: activation is `activateMode`'s job alone.
    expect(inserted[0]).toMatchObject({ businessId: BUSINESS, isActive: false, isArchived: false });
  });

  it('reports a name collision as NAME_TAKEN', async () => {
    const { db } = createDouble(0, uniqueViolation('uq_review_mode_name'));

    const outcome = await createMode(db, BUSINESS, {
      name: 'Balanced',
      description: null,
      contextTerms: [],
    });

    expect(outcome).toEqual({ ok: false, reason: 'NAME_TAKEN' });
  });

  it('rethrows a violation of any other constraint rather than blaming the name', async () => {
    const { db } = createDouble(0, uniqueViolation('uq_one_active_mode'));

    await expect(
      createMode(db, BUSINESS, { name: 'Balanced', description: null, contextTerms: [] }),
    ).rejects.toThrow(/unique constraint/);
  });
});

describe('updateMode', () => {
  it('clears is_active when restoring, so a restored mode cannot come back in use', async () => {
    // AI-02-02. uq_one_active_mode is partial — WHERE is_active AND NOT is_archived — so the
    // database does not forbid a row that is both active and archived. Un-archiving such a row
    // without this would either raise that index (reported to the owner as a name collision on a
    // name they never touched) or put a mode into use that they only asked to restore.
    const { db, sets } = updateDouble(storedRow({ isArchived: false }));

    const outcome = await updateMode(db, BUSINESS, MODE_ID, { isArchived: false });

    expect(outcome.ok).toBe(true);

    const isActive = sets[0]?.isActive;
    expect(isActive).toBeInstanceOf(SQL);

    // A CASE over the pre-update row, not a plain `false`: `is_archived: false` sent for a mode
    // that is already unarchived must not deactivate the mode in use.
    const chunks = (isActive as SQL).queryChunks;
    expect(chunks).toContain(reviewModes.isArchived);
    expect(chunks).toContain(reviewModes.isActive);
  });

  it('does not touch is_active when archiving', async () => {
    // The archive path enforces AI-02-02 in its WHERE clause instead, so that archiving the mode in
    // use is refused rather than silently deactivating it.
    const { db, sets } = updateDouble(storedRow({ isArchived: true }));

    await updateMode(db, BUSINESS, MODE_ID, { isArchived: true });

    expect(sets[0]).not.toHaveProperty('isActive');
    expect(sets[0]).toMatchObject({ isArchived: true });
  });

  it('does not touch is_active or is_archived on an ordinary edit', async () => {
    const { db, sets } = updateDouble(storedRow({ name: 'Lunch' }));

    await updateMode(db, BUSINESS, MODE_ID, { name: 'Lunch' });

    expect(sets[0]).not.toHaveProperty('isActive');
    expect(sets[0]).not.toHaveProperty('isArchived');
    expect(sets[0]).toMatchObject({ name: 'Lunch' });
  });

  it('reports a name collision as NAME_TAKEN', async () => {
    const { db } = updateDouble(undefined, uniqueViolation('uq_review_mode_name'));

    const outcome = await updateMode(db, BUSINESS, MODE_ID, { name: 'Balanced' });

    expect(outcome).toEqual({ ok: false, reason: 'NAME_TAKEN' });
  });

  it('rethrows uq_one_active_mode rather than telling the owner to rename a mode', async () => {
    // The regression this pins: mapping every 23505 to NAME_TAKEN told the owner "You already have
    // a mode with that name." about a name they had not touched, against a field the dialog was not
    // even showing.
    const { db } = updateDouble(undefined, uniqueViolation('uq_one_active_mode'));

    await expect(updateMode(db, BUSINESS, MODE_ID, { isArchived: false })).rejects.toThrow(
      /unique constraint/,
    );
  });
});

describe('isNameCollision', () => {
  it('is true for uq_review_mode_name', () => {
    expect(isNameCollision(uniqueViolation('uq_review_mode_name'))).toBe(true);
  });

  it('is false for uq_one_active_mode', () => {
    expect(isNameCollision(uniqueViolation('uq_one_active_mode'))).toBe(false);
  });

  it('is true for an unnamed unique violation, so the common case never becomes a 500', () => {
    expect(isNameCollision(uniqueViolation())).toBe(true);
    expect(isNameCollision(uniqueViolation(''))).toBe(true);
  });

  it('is false for anything that is not a unique violation', () => {
    expect(isNameCollision(Object.assign(new Error('bad input'), { code: '22P02' }))).toBe(false);
    expect(isNameCollision(new Error('connection lost'))).toBe(false);
    expect(isNameCollision(null)).toBe(false);
    expect(isNameCollision('23505')).toBe(false);
  });
});

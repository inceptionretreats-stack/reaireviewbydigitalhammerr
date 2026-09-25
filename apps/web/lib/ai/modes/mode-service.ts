import { and, asc, count, eq, ne, sql } from 'drizzle-orm';
import { businesses, reviewModes, type Database } from '@ai-review/db';

/**
 * Review-mode storage for AI-02.
 *
 * Every function here takes the tenant id that `requireTenant` resolved from the session and puts
 * it in the WHERE clause rather than checking it on a row that came back. That is what makes the
 * `{id}` in `/ai/modes/{id}` safe: the query cannot read or write another tenant's mode at all, so
 * a missing row and another tenant's row are indistinguishable to the caller, which is the IDOR
 * shape AC-003 tests for (RBAC rule 2).
 *
 * The AI-02-01 invariant — exactly one active mode — is a partial unique index in the schema
 * (`uq_one_active_mode` on business_id WHERE is_active AND NOT is_archived), so activation is
 * written as a transaction that deactivates then activates and *catches* the unique violation.
 * Reading "which mode is active" and then writing based on the answer would be a race with a
 * second tab, and the loser of that race would leave the tenant with two active modes or none.
 *
 * `@/lib/ai/generation-service` is the reader on the public side: it resolves the active mode with the
 * same `is_active AND NOT is_archived` filter, which is why nothing in this module has to defend
 * generation against a half-applied change.
 */

/**
 * 09_AI_Prompt_and_Generation_Spec.md lists six example modes, so a real tenant has a handful. The
 * cap exists so an unbounded SELECT can never become a multi-megabyte response; a tenant that
 * genuinely reaches it needs pagination on `/ai/modes`, not a bigger number on this line.
 */
export const MODE_LIST_LIMIT = 200;

/**
 * The most modes one tenant may hold, archived rows included.
 *
 * Deliberately equal to `MODE_LIST_LIMIT`, and the equality is the point, not a coincidence.
 * `listModes` truncates silently, and the row it drops first is the newest non-archived one —
 * which, because activating a mode does not reorder the list, is very often the mode actually in
 * use. A list missing the active mode makes `/app/ai-review` state that no mode is in use while
 * generation is using one, so the create is refused before the list can ever be short of the truth
 * (AI-02-01). Raising one of these numbers without the other reopens exactly that gap; a tenant
 * that genuinely reaches the cap needs pagination on `/ai/modes`, not a bigger number here.
 */
export const MODE_CREATE_LIMIT = MODE_LIST_LIMIT;

/**
 * Clears `is_active` while un-archiving — but only for a row that really was archived.
 *
 * `uq_one_active_mode` is partial (ON (business_id) WHERE is_active AND NOT is_archived), so
 * nothing in the database forbids a row that is active AND archived, whatever the schema comment
 * claims: a seeded, admin-written or hand-edited row can be both. Un-archiving such a row without
 * clearing is_active would either raise uq_one_active_mode — reported to the owner as a collision
 * on a name they never touched — or silently put a mode into use that they only asked to restore,
 * contradicting the "not in use until you choose it" confirmation. AI-02-02 says the two flags
 * cannot both be set, so the restore is where that gets repaired.
 *
 * A CASE rather than a plain `false` because SET expressions read the pre-update row: this clears
 * is_active only for a row that was archived, so `is_archived: false` sent for a mode that is
 * already unarchived cannot deactivate the mode in use.
 */
const CLEAR_ACTIVE_ON_RESTORE = sql<boolean>`
  case when ${reviewModes.isArchived} then false else ${reviewModes.isActive} end
`;

const MODE_COLUMNS = {
  id: reviewModes.id,
  name: reviewModes.name,
  description: reviewModes.description,
  contextTerms: reviewModes.contextTerms,
  isActive: reviewModes.isActive,
  isArchived: reviewModes.isArchived,
  createdAt: reviewModes.createdAt,
  updatedAt: reviewModes.updatedAt,
};

export interface ModeRecord {
  id: string;
  name: string;
  description: string | null;
  contextTerms: string[];
  isActive: boolean;
  isArchived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** The wire shape, in the snake_case the rest of `/api/v1` uses. */
export interface WireMode {
  id: string;
  name: string;
  description: string | null;
  context_terms: string[];
  is_active: boolean;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateModeValues {
  name: string;
  description: string | null;
  contextTerms: string[];
}

export interface UpdateModeValues {
  name?: string;
  description?: string | null;
  contextTerms?: string[];
  isArchived?: boolean;
}

export type CreateOutcome =
  { ok: true; mode: ModeRecord } | { ok: false; reason: 'NAME_TAKEN' | 'LIMIT_REACHED' };

export type UpdateOutcome =
  | { ok: true; mode: ModeRecord }
  | { ok: false; reason: 'NOT_FOUND' | 'NAME_TAKEN' | 'ACTIVE_CANNOT_ARCHIVE' };

export type ActivationOutcome =
  | { ok: true; mode: ModeRecord; previousActiveModeId: string | null }
  | { ok: false; reason: 'NOT_FOUND' | 'ARCHIVED' | 'CONTENDED' };

export function toWireMode(mode: ModeRecord): WireMode {
  return {
    id: mode.id,
    name: mode.name,
    description: mode.description,
    context_terms: mode.contextTerms,
    is_active: mode.isActive,
    is_archived: mode.isArchived,
    // UTC instants. Rendering them in businesses.timezone (AMENDMENT-004) is the client's job;
    // AC-026 governs analytics date filters, not the transport format of a timestamp.
    created_at: mode.createdAt.toISOString(),
    updated_at: mode.updatedAt.toISOString(),
  };
}

export async function listModes(db: Database, businessId: string): Promise<ModeRecord[]> {
  const rows = await db
    .select(MODE_COLUMNS)
    .from(reviewModes)
    .where(eq(reviewModes.businessId, businessId))
    // Archived modes last, then oldest first. Two reasons for the second half: Balanced — created
    // by the first save of /ai/context — stays at the top where the owner expects the default to
    // be, and the order does not reshuffle under a list whose rows carry Edit and Archive buttons,
    // which is how the wrong row gets clicked. id breaks ties because rows written in one
    // transaction can share created_at to the microsecond.
    .orderBy(asc(reviewModes.isArchived), asc(reviewModes.createdAt), asc(reviewModes.id))
    .limit(MODE_LIST_LIMIT);

  return rows.map(toRecord);
}

/**
 * How many modes this tenant already has, archived rows included.
 *
 * Counted in SQL rather than by measuring `listModes`, because that list is itself capped: a
 * capped list can never report that it is capped.
 */
export async function countModes(db: Database, businessId: string): Promise<number> {
  const [row] = await db
    .select({ modes: count() })
    .from(reviewModes)
    .where(eq(reviewModes.businessId, businessId));

  return row?.modes ?? 0;
}

export async function createMode(
  db: Database,
  businessId: string,
  values: CreateModeValues,
): Promise<CreateOutcome> {
  // Counted rather than trusted, and deliberately not atomic with the insert: a tenant racing
  // itself could end up one or two modes over, which is harmless for a sanity ceiling — the same
  // trade-off `POST /api/v1/qr` makes for MAX_SOURCES_PER_BUSINESS. What it protects is the
  // invariant that `listModes` never has to truncate, which an off-by-one does not threaten.
  if ((await countModes(db, businessId)) >= MODE_CREATE_LIMIT) {
    return { ok: false, reason: 'LIMIT_REACHED' };
  }

  try {
    const [row] = await db
      .insert(reviewModes)
      .values({
        businessId,
        name: values.name,
        description: values.description,
        contextTerms: values.contextTerms,
        // A new mode is never created active. Activation is one code path (`activateMode`) so that
        // AI-02-01 has one place to be right, and the owner activates from the list when they are
        // ready. config_version is deliberately not bumped here for the same reason: an inactive
        // mode changes nothing a customer would see.
        isActive: false,
        isArchived: false,
      })
      .returning(MODE_COLUMNS);

    // `returning` on a single-row insert always yields the row; the guard is for the type, and
    // throwing here would be a genuine invariant break rather than a user error.
    if (!row) throw new Error('insert into review_modes returned no row');

    return { ok: true, mode: toRecord(row) };
  } catch (error) {
    // Only uq_review_mode_name can fire on this insert: the row is written inactive, so the
    // partial index behind AI-02-01 does not apply to it. Checked by constraint name anyway, so
    // that a violation this reasoning did not anticipate is not reported as a naming mistake the
    // owner has to correct in a field they filled in correctly.
    if (isNameCollision(error)) return { ok: false, reason: 'NAME_TAKEN' };
    throw error;
  }
}

export async function updateMode(
  db: Database,
  businessId: string,
  modeId: string,
  values: UpdateModeValues,
): Promise<UpdateOutcome> {
  const archiving = values.isArchived === true;
  const restoring = values.isArchived === false;

  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .update(reviewModes)
        .set({
          ...(values.name === undefined ? {} : { name: values.name }),
          ...(values.description === undefined ? {} : { description: values.description }),
          ...(values.contextTerms === undefined ? {} : { contextTerms: values.contextTerms }),
          ...(values.isArchived === undefined ? {} : { isArchived: values.isArchived }),
          // AI-02-02: a restored mode must not come back active. See CLEAR_ACTIVE_ON_RESTORE.
          ...(restoring ? { isActive: CLEAR_ACTIVE_ON_RESTORE } : {}),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(reviewModes.id, modeId),
            eq(reviewModes.businessId, businessId),
            // AI-02-02, enforced in the WHERE clause rather than after a read. The schema's partial
            // unique index does NOT prevent a row from being both active and archived — it only
            // constrains rows that are active AND not archived — so archiving the mode currently in
            // use would produce exactly the state AI-02-02 forbids. Refusing it in SQL closes the
            // window a read-then-write would leave open, where a second tab activates this mode
            // between the check and the update. See the schema concern raised with this module.
            ...(archiving ? [eq(reviewModes.isActive, false)] : []),
          ),
        )
        .returning(MODE_COLUMNS);

      if (!row) {
        // Nothing was written, so there is nothing to roll back. The follow-up read exists only to
        // tell "no such mode" apart from "that mode is in use", and it is scoped to this tenant, so
        // it is not an existence oracle for another tenant's ids.
        if (archiving) {
          const [existing] = await tx
            .select({ id: reviewModes.id })
            .from(reviewModes)
            .where(and(eq(reviewModes.id, modeId), eq(reviewModes.businessId, businessId)))
            .limit(1);

          if (existing) return { ok: false, reason: 'ACTIVE_CANNOT_ARCHIVE' } as UpdateOutcome;
        }

        return { ok: false, reason: 'NOT_FOUND' } as UpdateOutcome;
      }

      // Only the active mode feeds a public generation, so only editing it changes what a customer
      // would see. Bumping unconditionally would invalidate the cached public configuration every
      // time an owner renamed a mode they are not using.
      //
      // config_version is a monotonically increasing marker rather than a count of edits, so the
      // clock keeps it increasing across replicas without a read-modify-write on the row — the same
      // reasoning as `bumpConfigVersion` in `api/v1/business/route.ts`.
      if (row.isActive) {
        await tx
          .update(businesses)
          .set({ configVersion: Date.now(), updatedAt: new Date() })
          .where(eq(businesses.id, businessId));
      }

      return { ok: true, mode: toRecord(row) } as UpdateOutcome;
    });
  } catch (error) {
    // Only the name constraint is mapped to a message about the name. The archive path excludes the
    // active row in its WHERE clause and the restore path clears is_active above, so
    // uq_one_active_mode is unreachable from here — and if a later edit makes it reachable again,
    // the owner gets an honest internal error rather than being told to rename a field the dialog
    // is not even showing.
    if (isNameCollision(error)) return { ok: false, reason: 'NAME_TAKEN' };
    throw error;
  }
}

/**
 * One retry, then report contention.
 *
 * The unique violation this catches means a concurrent activation committed between this
 * transaction's deactivate and its activate. A single retry is enough for that: the retry's
 * deactivate now sees the committed winner and clears it. A second failure means sustained
 * contention on one tenant's modes, which is not a state a single owner can produce, so it is
 * reported rather than retried in a loop.
 */
const ACTIVATION_ATTEMPTS = 2;

export async function activateMode(
  db: Database,
  businessId: string,
  modeId: string,
): Promise<ActivationOutcome> {
  for (let attempt = 1; attempt <= ACTIVATION_ATTEMPTS; attempt += 1) {
    try {
      return await runActivation(db, businessId, modeId);
    } catch (error) {
      if (error instanceof ModeVanishedError) return { ok: false, reason: 'ARCHIVED' };
      if (!isUniqueViolation(error)) throw error;
    }
  }

  return { ok: false, reason: 'CONTENDED' };
}

async function runActivation(
  db: Database,
  businessId: string,
  modeId: string,
): Promise<ActivationOutcome> {
  return db.transaction(async (tx) => {
    const [target] = await tx
      .select({ id: reviewModes.id, isArchived: reviewModes.isArchived })
      .from(reviewModes)
      .where(and(eq(reviewModes.id, modeId), eq(reviewModes.businessId, businessId)))
      .limit(1);

    // Both branches return before anything is written, so there is nothing to roll back — the same
    // shape `SlugService.claim` uses for its "taken" case.
    if (!target) return { ok: false, reason: 'NOT_FOUND' } as ActivationOutcome;
    if (target.isArchived) return { ok: false, reason: 'ARCHIVED' } as ActivationOutcome;

    // Deactivate first, activate second. The partial unique index is not deferrable, so it is
    // checked as each statement runs: doing this the other way round would raise a violation on
    // every ordinary switch rather than only on a genuine race. `ne` excludes the target so that
    // re-activating the mode already in use is a no-op rather than an off-then-on flicker.
    const [previous] = await tx
      .update(reviewModes)
      .set({ isActive: false, updatedAt: new Date() })
      .where(
        and(
          eq(reviewModes.businessId, businessId),
          eq(reviewModes.isActive, true),
          ne(reviewModes.id, modeId),
        ),
      )
      .returning({ id: reviewModes.id });

    const [activated] = await tx
      .update(reviewModes)
      .set({ isActive: true, updatedAt: new Date() })
      .where(
        and(
          eq(reviewModes.id, modeId),
          eq(reviewModes.businessId, businessId),
          // Re-checked at the moment of writing, not just at the read above: another session could
          // have archived this mode in between, and AI-02-02 must hold even then.
          eq(reviewModes.isArchived, false),
        ),
      )
      .returning(MODE_COLUMNS);

    // The row was there a moment ago and is not now, so the deactivate above must not stand —
    // otherwise the tenant is left with no active mode at all. Throwing rolls the transaction back.
    if (!activated) throw new ModeVanishedError();

    // Which mode is active changes what every customer's draft leans on, so the cached public
    // configuration is invalidated the same way an identity or link change invalidates it. The
    // clock, not a counter: monotonic across replicas with no read-modify-write on the row.
    await tx
      .update(businesses)
      .set({ configVersion: Date.now(), updatedAt: new Date() })
      .where(eq(businesses.id, businessId));

    return {
      ok: true,
      mode: toRecord(activated),
      previousActiveModeId: previous?.id ?? null,
    } as ActivationOutcome;
  });
}

/**
 * Raised when the target mode disappears or is archived between the read and the write inside one
 * activation. Its only job is to roll the transaction back; the caller maps it to ARCHIVED, which
 * is the realistic cause — a mode cannot be deleted, only archived.
 */
class ModeVanishedError extends Error {
  constructor() {
    super('review mode became unavailable during activation');
    this.name = 'ModeVanishedError';
  }
}

interface RawModeRow {
  id: string;
  name: string;
  description: string | null;
  contextTerms: unknown;
  isActive: boolean;
  isArchived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

function toRecord(row: RawModeRow): ModeRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    contextTerms: toStringArray(row.contextTerms),
    isActive: row.isActive,
    isArchived: row.isArchived,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * `context_terms` is jsonb with no `$type<string[]>()`, so Drizzle hands it back as `unknown`.
 * Narrowed rather than cast: the column is only written through this module, but a seeded or
 * hand-edited row can hold anything, and a bad value should degrade to an empty list instead of
 * crashing the screen that renders it.
 */
function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

/** 23505 is Postgres unique_violation. */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

/**
 * True only for a violation of `uq_review_mode_name`.
 *
 * review_modes carries two unique indexes, and they mean opposite things to the owner: one is a
 * name they can fix in the form, the other is a broken AI-02-01 invariant they cannot fix at all.
 * Mapping both onto "You already have a mode with that name" tells the owner to correct a field
 * that is not wrong, so the constraint name decides.
 *
 * An unnamed 23505 is still treated as the name collision: every driver we use reports
 * `constraint`, but if one stopped, the common case must not start failing as a 500. A violation
 * that names a *different* constraint is rethrown, because it is an invariant break rather than a
 * user error.
 *
 * Exported for its unit test: it is the one piece of the two failure paths above that can be
 * checked without a database.
 */
export function isNameCollision(error: unknown): boolean {
  if (!isUniqueViolation(error)) return false;

  const constraint = readConstraint(error);
  return constraint === null || constraint === 'uq_review_mode_name';
}

/** The `constraint` field node-postgres puts on a DatabaseError, when it is present. */
function readConstraint(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('constraint' in error)) return null;

  const { constraint } = error as { constraint: unknown };
  return typeof constraint === 'string' && constraint !== '' ? constraint : null;
}

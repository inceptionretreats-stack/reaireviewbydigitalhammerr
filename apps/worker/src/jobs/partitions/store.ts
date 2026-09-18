import { sql } from 'drizzle-orm';
import type { Executor } from '@ai-review/core';
import { DEFAULT_PARTITION_NAME, firstDayOf, parsePartitionName, type YearMonth } from './window';

/**
 * Partition maintenance storage contract (AMENDMENT-012).
 *
 * `listPartitions` returns only tables actually attached to `analytics_events`. That is the
 * load-bearing guard: the drop path can then never name a table that is not a partition of
 * this one table, whatever a bug elsewhere computes.
 */
export interface PartitionStore {
  /** Idempotent; returns the partition name. */
  ensurePartition(month: YearMonth): Promise<string>;
  listPartitions(): Promise<string[]>;
  countRows(partitionName: string): Promise<number>;
  dropPartition(partitionName: string): Promise<void>;
}

export class PostgresPartitionStore implements PartitionStore {
  constructor(private readonly db: Executor) {}

  /**
   * Calls the SQL function defined in packages/db/drizzle/0000_initial_schema.sql rather than
   * issuing CREATE TABLE ... PARTITION OF here. The function already does the exists-check and
   * the bound arithmetic, and keeping one definition means the worker and the migration cannot
   * disagree about what a partition is called or where its boundaries fall.
   */
  async ensurePartition(month: YearMonth): Promise<string> {
    const result = await this.db.execute<{ partition_name: string }>(
      sql`select ensure_analytics_events_partition(${firstDayOf(month)}::date) as partition_name`,
    );

    const name = result.rows[0]?.partition_name;
    if (typeof name !== 'string') {
      throw new Error(
        `ensure_analytics_events_partition(${firstDayOf(month)}) returned no partition name`,
      );
    }
    return name;
  }

  async listPartitions(): Promise<string[]> {
    const result = await this.db.execute<{ partition_name: string }>(sql`
      select child.relname as partition_name
      from pg_inherits
      join pg_class child on child.oid = pg_inherits.inhrelid
      join pg_class parent on parent.oid = pg_inherits.inhparent
      join pg_namespace child_ns on child_ns.oid = child.relnamespace
      join pg_namespace parent_ns on parent_ns.oid = parent.relnamespace
      where parent.relname = 'analytics_events'
        and parent_ns.nspname = 'public'
        and child_ns.nspname = 'public'
      order by child.relname
    `);

    return result.rows
      .map((row) => row.partition_name)
      .filter((name): name is string => typeof name === 'string');
  }

  /** Read-only, so the DEFAULT partition is allowed here — the job has to check it is empty. */
  async countRows(partitionName: string): Promise<number> {
    const result = await this.db.execute<{ row_count: string | number }>(
      sql`select count(*) as row_count from ${sql.identifier(assertReadable(partitionName))}`,
    );

    // count(*) is bigint, which node-postgres returns as a string to avoid precision loss.
    return Number(result.rows[0]?.row_count ?? 0);
  }

  async dropPartition(partitionName: string): Promise<void> {
    // No IF EXISTS: if the table is not there, the caller's view of reality is wrong and
    // should fail loudly rather than report a successful drop of nothing.
    await this.db.execute(sql`drop table ${sql.identifier(assertDroppable(partitionName))}`);
  }
}

/** A name this module will read from: a month partition, or the DEFAULT catch-all. */
function assertReadable(partitionName: string): string {
  if (partitionName === DEFAULT_PARTITION_NAME) return partitionName;
  return assertDroppable(partitionName);
}

/**
 * Last line of defence before an identifier reaches DDL.
 *
 * The name always comes from listPartitions, so it is already a real partition of
 * analytics_events; it is re-checked against the exact month pattern anyway, because the cost
 * of being wrong here is a dropped table and the cost of the check is a regex. The DEFAULT
 * partition fails this check by construction: it carries no month, and AC-035 depends on it
 * existing.
 */
function assertDroppable(partitionName: string): string {
  if (!parsePartitionName(partitionName)) {
    throw new Error(`Refusing to operate on ${partitionName}: not a month partition name`);
  }
  return partitionName;
}

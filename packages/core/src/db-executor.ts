import type { Database } from '@ai-review/db';

/**
 * Either the pooled database or the transaction handle drizzle passes into `db.transaction`.
 *
 * Services that must write an audit row in the same transaction as the change they describe
 * take this rather than `Database`, so the entry and the mutation commit or roll back together.
 * An audit row for a change that never happened is worse than none.
 */
export type Executor = Database | Parameters<Parameters<Database['transaction']>[0]>[0];

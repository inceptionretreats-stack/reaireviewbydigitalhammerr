import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { createPoolConfig, type DatabaseConfig } from './connection';
import * as schema from './schema/index';

export * from './schema/index';
export { createPoolConfig, migrationDatabaseConfig, type DatabaseConfig } from './connection';
export { schema };

export type Database = ReturnType<typeof createDatabase>;

/**
 * One pool per process. Persistent workers can use the default connection budget; serverless
 * deployments should explicitly set min=0/max=1 and use the provider's transaction pooler.
 */
export function createDatabase(config: DatabaseConfig) {
  const pool = new Pool(createPoolConfig(config));

  /**
   * node-postgres emits 'error' when an *idle* pooled client dies — a Postgres restart, a managed
   * provider reaping idle connections, a network partition. With no listener attached, Node treats
   * that as an uncaughtException and takes the whole container down, turning a recoverable blip
   * into an outage and making a nonsense of the RTO in 14_DevOps_Deployment_Runbook.md.
   *
   * The pool has already discarded the dead client by this point and will open a fresh one on the
   * next checkout, so there is nothing to repair here: logging it is the whole correct response.
   * In-flight queries reject on their own promise and are handled by their caller.
   */
  pool.on('error', (error) => {
    console.error('[db] idle client error; the pool will replace the connection', error);
  });

  return drizzle(pool, { schema, casing: 'snake_case' });
}

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool, type PoolConfig } from 'pg';
import * as schema from './schema/index';

export * from './schema/index';
export { schema };

export type Database = ReturnType<typeof createDatabase>;

export interface DatabaseConfig {
  connectionString: string;
  poolMin?: number;
  poolMax?: number;
  /**
   * TLS mode. Managed Postgres (DigitalOcean, Neon, RDS) requires TLS and will refuse a plain
   * connection; a local docker instance has no certificate at all. Defaults to 'require' for
   * any non-local host, because failing closed on transport security is the safer default.
   */
  ssl?: 'disable' | 'require' | 'verify-full';
  /** PEM CA bundle for 'verify-full'. DigitalOcean issues its own; Neon uses a public root. */
  sslRootCert?: string;
}

/**
 * Long-lived pooled client. The app runs as persistent containers, not serverless functions,
 * so a normal node-postgres pool is correct — no HTTP driver needed.
 *
 * Connection budget (02_System_Architecture.md, 15_Environment_Variables.example): poolMax
 * defaults to 20 per process. Two web containers plus one worker is 60 connections, which must
 * stay under the tier's limit. Put PgBouncer in front before scaling web wider.
 */
export function createDatabase(config: DatabaseConfig) {
  const pool = new Pool({
    connectionString: config.connectionString,
    min: config.poolMin ?? 2,
    max: config.poolMax ?? 20,
    ssl: resolveSsl(config),
  });

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

function resolveSsl(config: DatabaseConfig): PoolConfig['ssl'] {
  const mode = config.ssl ?? (isLocalHost(config.connectionString) ? 'disable' : 'require');

  switch (mode) {
    case 'disable':
      return undefined;
    case 'verify-full':
      // Full verification needs a CA. Without one this would silently downgrade, so it throws.
      if (!config.sslRootCert) {
        throw new Error('ssl: "verify-full" requires sslRootCert (the provider CA bundle)');
      }
      return { rejectUnauthorized: true, ca: config.sslRootCert };
    case 'require':
      // Encrypted transport without chain verification — what managed providers accept out of
      // the box. Move to verify-full once the provider CA is in the secret store.
      return { rejectUnauthorized: false };
  }
}

function isLocalHost(connectionString: string): boolean {
  try {
    const { hostname } = new URL(connectionString);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch {
    return false;
  }
}

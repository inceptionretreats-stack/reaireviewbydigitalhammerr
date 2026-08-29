import { createDatabase, type Database } from '@ai-review/db';
import { env } from './env';

let cached: Database | undefined;

/** One pool per process. See the connection-budget note in packages/db. */
export function db(): Database {
  cached ??= createDatabase({
    connectionString: env().DATABASE_URL,
    poolMin: env().DATABASE_POOL_MIN,
    poolMax: env().DATABASE_POOL_MAX,
    ssl: env().DATABASE_SSL,
    sslRootCert: env().DATABASE_SSL_ROOT_CERT,
  });
  return cached;
}

import type { PoolConfig } from 'pg';

export interface DatabaseConfig {
  connectionString: string;
  poolMin?: number;
  poolMax?: number;
  /** Explicit settings override TLS parameters embedded in the connection URL. */
  ssl?: 'disable' | 'require' | 'verify-full';
  /** PEM CA bundle. Supplying a CA without a mode enables full verification. */
  sslRootCert?: string;
}

const TLS_URL_PARAMETERS = [
  'ssl',
  'sslmode',
  'sslrootcert',
  'sslcert',
  'sslkey',
  'sslnegotiation',
  'uselibpqcompat',
];

/**
 * Shared by the runtime and release migration runner. node-postgres lets URL TLS parameters
 * replace the entire ssl object, including its CA, so explicit settings must remove those
 * parameters before the URL reaches the driver. URL-only settings keep the driver's behavior.
 */
export function createPoolConfig(config: DatabaseConfig): PoolConfig {
  if (config.ssl !== undefined && !['disable', 'require', 'verify-full'].includes(config.ssl)) {
    throw new Error('Database TLS mode must be disable, require, or verify-full.');
  }
  let url: URL;
  try {
    url = new URL(config.connectionString);
  } catch {
    throw new Error('Database connection URL must be a valid PostgreSQL URL.');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('Database connection URL must use postgres:// or postgresql://.');
  }

  const max = config.poolMax ?? 20;
  const min = config.poolMin ?? Math.min(2, max);
  if (!Number.isInteger(max) || max < 1 || !Number.isInteger(min) || min < 0 || min > max) {
    throw new Error('Database pool sizes must be integers with 0 <= min <= max and max >= 1.');
  }

  const explicitMode = config.ssl ?? (config.sslRootCert ? 'verify-full' : undefined);
  const hasUrlTls = TLS_URL_PARAMETERS.some(
    (key) => key !== 'uselibpqcompat' && Boolean(url.searchParams.get(key)),
  );
  const hostname = (url.searchParams.get('host') || url.hostname).replace(/^\[|\]$/g, '');
  const local = ['localhost', '127.0.0.1', '::1'].includes(hostname);
  const mode = explicitMode ?? (hasUrlTls ? undefined : local ? 'disable' : 'require');

  let connectionString = config.connectionString;
  if (explicitMode !== undefined) {
    for (const key of TLS_URL_PARAMETERS) url.searchParams.delete(key);
    connectionString = url.toString();
  }

  let ssl: PoolConfig['ssl'];
  switch (mode) {
    case 'disable':
      // false also prevents a machine-level PGSSLMODE from undoing an explicit local override.
      ssl = false;
      break;
    case 'require':
      ssl = { rejectUnauthorized: false };
      break;
    case 'verify-full':
      if (!config.sslRootCert?.trim()) {
        throw new Error('ssl: "verify-full" requires sslRootCert (the provider CA bundle).');
      }
      ssl = { rejectUnauthorized: true, ca: config.sslRootCert };
      break;
  }

  return { connectionString, min, max, ...(ssl === undefined ? {} : { ssl }) };
}

/** Prefer a direct/session connection for schema changes; keep DATABASE_URL as a legacy fallback. */
export function migrationDatabaseConfig(source: NodeJS.ProcessEnv = process.env): DatabaseConfig {
  const connectionString = source.DIRECT_DATABASE_URL?.trim() || source.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error('DIRECT_DATABASE_URL or DATABASE_URL is required to run migrations.');
  }

  const ssl = source.DATABASE_SSL || undefined;
  if (ssl !== undefined && ssl !== 'disable' && ssl !== 'require' && ssl !== 'verify-full') {
    throw new Error('DATABASE_SSL must be disable, require, or verify-full.');
  }

  return {
    connectionString,
    poolMin: 0,
    poolMax: 1,
    ssl,
    sslRootCert: source.DATABASE_SSL_ROOT_CERT || undefined,
  };
}

import { Pool } from 'pg';

/**
 * Integration tests demand a real database and refuse to silently skip.
 *
 * A skipped integration suite reads as a passing one in CI output, which is exactly the
 * failure mode this suite exists to close.
 */
export function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is required for the integration suite. Run `pnpm test:integration` ' +
        'against a disposable database, never a production one.',
    );
  }
  return url;
}

export function createTestPool(): Pool {
  return new Pool({ connectionString: requireDatabaseUrl(), max: 8 });
}

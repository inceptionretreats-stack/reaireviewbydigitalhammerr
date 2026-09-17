import { fileURLToPath, pathToFileURL } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { createPoolConfig, migrationDatabaseConfig } from './connection';

/**
 * One-shot migration runner.
 *
 * 14_DevOps_Deployment_Runbook.md is explicit that migrations run as a controlled task and
 * never from every app replica on boot — concurrent replicas racing the same DDL is how a
 * deploy corrupts its own schema. This is invoked as a release step, before the API and
 * worker roll (deployment order steps 3-5).
 */
export async function runMigrations(source: NodeJS.ProcessEnv = process.env): Promise<void> {
  const pool = new Pool(createPoolConfig(migrationDatabaseConfig(source)));
  const db = drizzle(pool);

  try {
    console.warn('Running migrations...');
    await migrate(db, { migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) });
    console.warn('Migrations complete.');
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runMigrations().catch((error: unknown) => {
    console.error('Migration failed:', error);
    process.exitCode = 1;
  });
}

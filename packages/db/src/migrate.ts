import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

/**
 * One-shot migration runner.
 *
 * 14_DevOps_Deployment_Runbook.md is explicit that migrations run as a controlled task and
 * never from every app replica on boot — concurrent replicas racing the same DDL is how a
 * deploy corrupts its own schema. This is invoked as a release step, before the API and
 * worker roll (deployment order steps 3-5).
 */
async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL is required to run migrations.');
    process.exit(1);
  }

  const pool = new Pool({ connectionString, max: 1 });
  const db = drizzle(pool);

  try {
    console.warn('Running migrations...');
    await migrate(db, { migrationsFolder: './drizzle' });
    console.warn('Migrations complete.');
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error('Migration failed:', error);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * Local PostgreSQL for development.
 *
 * There is no system PostgreSQL and no Docker on every developer's machine, and the app is
 * unusable without a database — every screen past the login form reads one. This runs a real
 * PostgreSQL 18 server from the binaries shipped by `embedded-postgres`, so the full stack
 * works offline with no install ceremony.
 *
 * It is real PostgreSQL, not an emulator, which matters here: the schema uses citext, pgcrypto,
 * declarative range partitioning, partial unique indexes and CHECK constraints. A wire-compatible
 * stand-in would accept the migration and diverge on exactly the things worth testing.
 *
 * Development only. Production is managed PostgreSQL (ADR-AMEND-B).
 *
 *   node scripts/dev-db.mjs start     start and keep running
 *   node scripts/dev-db.mjs stop      stop
 */
import EmbeddedPostgres from 'embedded-postgres';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const DATA_DIR = resolve('.pgdata');
const PORT = 5432;
const USER = 'postgres';
const PASSWORD = 'postgres';
const DATABASE = 'ai_review';

mkdirSync(DATA_DIR, { recursive: true });

const pg = new EmbeddedPostgres({
  databaseDir: DATA_DIR,
  user: USER,
  password: PASSWORD,
  port: PORT,
  persistent: true,
});

const command = process.argv[2] ?? 'start';

async function start() {
  // initialise() is only valid on an empty directory; on a second run the cluster already
  // exists and initialising again would fail, so the error is inspected rather than assumed.
  try {
    await pg.initialise();
    console.log('Initialised a new cluster in .pgdata');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/exists|not empty/i.test(message)) throw error;
    console.log('Reusing the existing cluster in .pgdata');
  }

  await pg.start();
  console.log(`PostgreSQL listening on localhost:${PORT}`);

  try {
    await pg.createDatabase(DATABASE);
    console.log(`Created database "${DATABASE}"`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/already exists/i.test(message)) throw error;
    console.log(`Database "${DATABASE}" already exists`);
  }

  console.log(`\nDATABASE_URL=postgresql://${USER}:${PASSWORD}@localhost:${PORT}/${DATABASE}`);
  console.log('\nRunning. Press Ctrl+C to stop.');

  const shutdown = async () => {
    console.log('\nStopping PostgreSQL...');
    await pg.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Hold the process open; the server runs as a child of this one.
  setInterval(() => {}, 1 << 30);
}

if (command === 'start') {
  await start();
} else if (command === 'stop') {
  await pg.stop();
  console.log('Stopped.');
} else {
  console.error(`Unknown command: ${command}. Use "start" or "stop".`);
  process.exit(1);
}

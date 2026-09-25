/**
 * Moves the local database to UTF-8, keeping every row.
 *
 *   node --env-file=.env scripts/db/db-reencode.mjs           # do it
 *   node --env-file=.env scripts/db/db-reencode.mjs --check   # just report the encoding
 *
 * Why. The embedded cluster was initialised with Windows' default locale, which made the
 * database WIN1252 — an encoding with no room for an emoji, a Devanagari character, or a
 * business name in any script but Latin. The first draft containing one failed to save with
 * `22P05 untranslatable character` and the customer saw a 500. Nothing had put such a character
 * in a draft until CHANGE-003's Hinglish drafts started carrying emoji.
 *
 * The embedded build ships no pg_dump, so this does the copy itself: a new database in the same
 * cluster with UTF-8 and the builtin C.UTF-8 locale, the migrations run against it, every table's
 * rows copied in foreign-key order with jsonb and identity columns handled, counts verified, and
 * the two databases swapped by rename. The old one stays behind as `<name>_win1252_backup` until
 * someone drops it on purpose.
 *
 * dev-db.mjs now initialises new clusters as UTF-8 outright; this exists for the one that
 * already had data in it.
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required (run with --env-file=.env).');
  process.exit(1);
}
const target = new URL(url);
const DB = target.pathname.replace(/^\//, '');
const NEW_DB = `${DB}_utf8`;
const BACKUP_DB = `${DB}_win1252_backup`;
const checkOnly = process.argv.includes('--check');

const admin = new pg.Client({ connectionString: withDatabase('postgres') });
await admin.connect();

const encoding = (
  await admin.query(
    'SELECT pg_encoding_to_char(encoding) AS enc FROM pg_database WHERE datname = $1',
    [DB],
  )
).rows[0]?.enc;
console.log(`  ${DB}: ${encoding ?? 'missing'}`);
if (encoding === 'UTF8') {
  console.log('  Already UTF-8. Nothing to do.');
  await admin.end();
  process.exit(0);
}
if (checkOnly) {
  await admin.end();
  process.exit(encoding === 'UTF8' ? 0 : 1);
}

// 1. A fresh UTF-8 database. template0 is the only template that allows a different encoding.
await admin.query(`DROP DATABASE IF EXISTS "${NEW_DB}"`);
await admin.query(
  `CREATE DATABASE "${NEW_DB}" TEMPLATE template0 ENCODING 'UTF8'
     LOCALE_PROVIDER builtin BUILTIN_LOCALE 'C.UTF-8'`,
);
console.log(`  created ${NEW_DB} (UTF8, builtin C.UTF-8)`);

// 2. Schema from the migrations, exactly as any environment gets it.
const migrated = spawnSync(
  process.execPath,
  [join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'src/migrate.ts'],
  {
    cwd: join(ROOT, 'packages', 'db'),
    env: { ...process.env, DATABASE_URL: withDatabase(NEW_DB) },
    stdio: 'inherit',
    windowsHide: true,
  },
);
if (migrated.status !== 0) {
  console.error('  migrations failed against the new database; nothing was changed.');
  process.exit(1);
}

// 3. Copy every row. Partition children are skipped: inserting into the parent routes the row.
const from = new pg.Client({ connectionString: url });
const to = new pg.Client({ connectionString: withDatabase(NEW_DB) });
await from.connect();
await to.connect();

const tables = await orderedTables(from);
const counts = [];
await to.query('BEGIN');
try {
  // Triggers that maintain derived state (quota resets) must not fire on a verbatim copy.
  await to.query("SET session_replication_role = 'replica'");
  for (const table of tables) {
    const columns = await columnsOf(from, table);
    const identity = columns.filter((c) => c.identity).map((c) => c.name);
    const { rows } = await from.query(`SELECT * FROM "${table}"`);
    for (const row of rows) {
      const names = columns.map((c) => `"${c.name}"`).join(', ');
      const params = columns.map((_, i) => `$${i + 1}`).join(', ');
      const values = columns.map((c) => encode(row[c.name], c));
      await to.query(
        `INSERT INTO "${table}" (${names}) ${identity.length ? 'OVERRIDING SYSTEM VALUE ' : ''}VALUES (${params})`,
        values,
      );
    }
    for (const column of identity) {
      await to.query(
        `SELECT setval(pg_get_serial_sequence('"${table}"', '${column}'),
                       COALESCE((SELECT MAX("${column}") FROM "${table}"), 0) + 1, false)`,
      );
    }
    const copied = Number((await to.query(`SELECT COUNT(*) FROM "${table}"`)).rows[0].count);
    counts.push({ table, rows: rows.length, copied });
    if (copied !== rows.length)
      throw new Error(`${table}: ${rows.length} rows read, ${copied} written`);
  }
  await to.query("SET session_replication_role = 'origin'");
  await to.query('COMMIT');
} catch (error) {
  await to.query('ROLLBACK');
  console.error(`  copy failed: ${error instanceof Error ? error.message : String(error)}`);
  console.error('  The original database is untouched.');
  process.exit(1);
} finally {
  await from.end();
  await to.end();
}
console.table(counts.filter((c) => c.rows > 0));

// 4. Swap by rename. Every other connection to the old database has to be gone first.
await admin.query(`DROP DATABASE IF EXISTS "${BACKUP_DB}"`);
await admin.query(
  `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
    WHERE datname IN ($1, $2) AND pid <> pg_backend_pid()`,
  [DB, NEW_DB],
);
await admin.query(`ALTER DATABASE "${DB}" RENAME TO "${BACKUP_DB}"`);
await admin.query(`ALTER DATABASE "${NEW_DB}" RENAME TO "${DB}"`);
console.log(`\n  ${DB} is now UTF-8. The old database is kept as ${BACKUP_DB}.`);
console.log('  Restart the web server so its pool reconnects: pnpm dev:up --restart-web');
await admin.end();

// ---------------------------------------------------------------------------------------------

function withDatabase(name) {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

/** Base tables in dependency order: parents before the tables that reference them. */
async function orderedTables(client) {
  const { rows: base } = await client.query(`
    SELECT c.relname AS name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
       AND NOT EXISTS (SELECT 1 FROM pg_inherits i WHERE i.inhrelid = c.oid)`);
  const { rows: fks } = await client.query(`
    SELECT DISTINCT c.conrelid::regclass::text AS child, c.confrelid::regclass::text AS parent
      FROM pg_constraint c
     WHERE c.contype = 'f' AND c.conrelid <> c.confrelid
       AND c.connamespace = 'public'::regnamespace`);
  const names = base.map((r) => r.name);
  const deps = new Map(names.map((n) => [n, new Set()]));
  for (const { child, parent } of fks) {
    const c = child.replace(/^"|"$/g, '');
    const p = parent.replace(/^"|"$/g, '');
    if (deps.has(c) && deps.has(p)) deps.get(c).add(p);
  }
  const ordered = [];
  const done = new Set();
  const visit = (name, trail = new Set()) => {
    if (done.has(name)) return;
    // A cycle (businesses <-> business_slugs) is fine: constraint checks are off for the copy,
    // and ordering is only a courtesy to the reader of the counts table.
    if (trail.has(name)) return;
    trail.add(name);
    for (const dep of deps.get(name)) visit(dep, trail);
    done.add(name);
    ordered.push(name);
  };
  for (const name of names) visit(name);
  return ordered.filter((name) => name !== '__drizzle_migrations');
}

async function columnsOf(client, table) {
  const { rows } = await client.query(
    `SELECT column_name AS name, data_type AS type, udt_name AS udt, is_identity = 'YES' AS identity
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position`,
    [table],
  );
  return rows;
}

/** node-postgres serialises a JS array as a Postgres array; a jsonb column needs JSON text. */
function encode(value, column) {
  if (value === null || value === undefined) return null;
  if (column.type === 'jsonb' || column.type === 'json') return JSON.stringify(value);
  return value;
}

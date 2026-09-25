/**
 * Read-only migration manifests. No environment, connection, logging, or transaction ownership.
 *
 * Caller contract (use the SAME pinned node-postgres Client, never a Pool):
 *   await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 *   await client.query(INVENTORY_SESSION_SQL);
 *   // Optionally pg_export_snapshot() here and pass that snapshot to pg_dump.
 *   const manifest = await inventory(client);
 *   // Caller commits/rolls back only after both inventory and snapshot consumers finish.
 *
 * Quiesce writers before the final cutover: sequence state is NOT MVCC-snapshot consistent.
 * Each digest scans and sorts the entire table. Run in a maintenance window, not an API route.
 * Row values stay inside PostgreSQL; only SHA-256 row hashes cross the wire in bounded batches.
 * Manifests contain schema metadata and aggregate hashes, not customer rows or connection details.
 * Treat them as internal artifacts: metadata/default expressions can still be sensitive.
 */
import { createHash } from 'node:crypto';

const SCHEMAS = Object.freeze(['drizzle', 'public']);
const FORMAT_VERSION = 1;
const ALGORITHM = 'sha256-sorted-jsonb-row-hashes-v1';
const SETTINGS = Object.freeze({
  TimeZone: 'UTC',
  DateStyle: 'ISO, YMD',
  IntervalStyle: 'postgres',
  extra_float_digits: '3',
  bytea_output: 'hex',
  search_path: 'pg_catalog',
  row_security: 'off',
});

export const INVENTORY_SESSION_SQL = Object.entries(SETTINGS)
  .map(([name, value]) => `SET LOCAL ${name} = '${value}';`)
  .join('\n');

export class InventoryError extends Error {
  constructor(code) {
    // Deliberately do not propagate SQL error detail, cause, query parameters, or credentials.
    super(`Database inventory failed (${code}). Caller must roll back its transaction.`);
    this.name = 'InventoryError';
    this.code = code;
  }
}

const SESSION_SQL = `/* inventory:session */
SELECT current_setting('server_version_num') AS "serverVersion",
       current_setting('transaction_isolation') AS isolation,
       current_setting('transaction_read_only') AS "readOnly",
       current_setting('TimeZone') AS "TimeZone",
       current_setting('DateStyle') AS "DateStyle",
       current_setting('IntervalStyle') AS "IntervalStyle",
       current_setting('extra_float_digits') AS extra_float_digits,
       current_setting('bytea_output') AS bytea_output,
       current_setting('search_path') AS search_path,
       current_setting('row_security') AS row_security`;

const TABLES_SQL = `/* inventory:tables */
SELECT n.nspname AS schema, c.relname AS name, c.relkind AS kind,
       c.relpersistence AS persistence, c.relispartition AS "isPartition",
       c.relrowsecurity AS "rowSecurity", c.relforcerowsecurity AS "forceRowSecurity",
       c.relreplident AS "replicaIdentity",
       pg_get_partkeydef(c.oid) AS "partitionKey",
       pg_get_expr(c.relpartbound, c.oid, false) AS "partitionBound",
       COALESCE((SELECT jsonb_agg(jsonb_build_object(
         'schema', pn.nspname, 'name', pc.relname, 'position', i.inhseqno
       ) ORDER BY i.inhseqno)
       FROM pg_inherits i JOIN pg_class pc ON pc.oid = i.inhparent
       JOIN pg_namespace pn ON pn.oid = pc.relnamespace
       WHERE i.inhrelid = c.oid), '[]'::jsonb) AS parents
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = ANY($1::text[]) AND c.relkind IN ('r', 'p', 'f')
ORDER BY n.nspname COLLATE "C", c.relname COLLATE "C"`;

const COLUMNS_SQL = `/* inventory:columns */
SELECT n.nspname AS schema, c.relname AS "table", a.attnum AS position,
       a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type,
       a.attnotnull AS "notNull", a.attidentity AS identity,
       a.attgenerated AS generated,
       pg_get_expr(d.adbin, d.adrelid, false) AS "defaultExpression",
       CASE WHEN a.attcollation = 0 THEN NULL
         ELSE format('%I.%I', cn.nspname, co.collname) END AS collation
FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
LEFT JOIN pg_collation co ON co.oid = a.attcollation
LEFT JOIN pg_namespace cn ON cn.oid = co.collnamespace
WHERE n.nspname = ANY($1::text[]) AND c.relkind IN ('r', 'p')
  AND a.attnum > 0 AND NOT a.attisdropped
ORDER BY n.nspname COLLATE "C", c.relname COLLATE "C", a.attnum`;

const CONSTRAINTS_SQL = `/* inventory:constraints */
SELECT n.nspname AS schema, c.relname AS "table", con.conname AS name,
       con.contype AS type, pg_get_constraintdef(con.oid, false) AS definition,
       con.condeferrable AS deferrable, con.condeferred AS deferred,
       con.convalidated AS validated, con.conislocal AS "isLocal",
       con.coninhcount AS "inheritanceCount", con.connoinherit AS "noInherit"
FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = ANY($1::text[]) AND c.relkind IN ('r', 'p')
ORDER BY n.nspname COLLATE "C", c.relname COLLATE "C", con.conname COLLATE "C"`;

const INDEXES_SQL = `/* inventory:indexes */
SELECT n.nspname AS schema, t.relname AS "table", idx.relname AS name,
       idx.relkind AS kind, pg_get_indexdef(i.indexrelid, 0, false) AS definition,
       i.indisunique AS unique, i.indisprimary AS primary, i.indisexclusion AS exclusion,
       i.indisvalid AS valid, i.indisready AS ready, i.indisreplident AS "replicaIdentity",
       COALESCE((SELECT jsonb_agg(jsonb_build_object('schema', pn.nspname, 'name', pc.relname)
         ORDER BY pn.nspname COLLATE "C", pc.relname COLLATE "C")
         FROM pg_inherits inh JOIN pg_class pc ON pc.oid = inh.inhparent
         JOIN pg_namespace pn ON pn.oid = pc.relnamespace
         WHERE inh.inhrelid = idx.oid), '[]'::jsonb) AS parents
FROM pg_index i JOIN pg_class idx ON idx.oid = i.indexrelid
JOIN pg_class t ON t.oid = i.indrelid JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname = ANY($1::text[]) AND t.relkind IN ('r', 'p')
ORDER BY n.nspname COLLATE "C", t.relname COLLATE "C", idx.relname COLLATE "C"`;

const SEQUENCES_SQL = `/* inventory:sequences */
SELECT n.nspname AS schema, c.relname AS name,
       format_type(s.seqtypid, NULL) AS type, s.seqstart::text AS start,
       s.seqincrement::text AS increment, s.seqmin::text AS minimum,
       s.seqmax::text AS maximum, s.seqcache::text AS cache, s.seqcycle AS cycle,
       COALESCE((SELECT jsonb_agg(jsonb_build_object(
         'schema', tn.nspname, 'table', t.relname, 'column', a.attname, 'dependency', d.deptype
       ) ORDER BY tn.nspname COLLATE "C", t.relname COLLATE "C", a.attnum)
       FROM pg_depend d JOIN pg_class t ON t.oid = d.refobjid
       JOIN pg_namespace tn ON tn.oid = t.relnamespace
       JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
       WHERE d.objid = c.oid AND d.classid = 'pg_class'::regclass
         AND d.refclassid = 'pg_class'::regclass AND d.deptype IN ('a', 'i')),
       '[]'::jsonb) AS "ownedBy"
FROM pg_sequence s JOIN pg_class c ON c.oid = s.seqrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = ANY($1::text[])
ORDER BY n.nspname COLLATE "C", c.relname COLLATE "C"`;

const ENUMS_SQL = `/* inventory:enums */
SELECT n.nspname AS schema, t.typname AS name,
       jsonb_agg(e.enumlabel ORDER BY e.enumsortorder) AS labels
FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
JOIN pg_enum e ON e.enumtypid = t.oid
WHERE n.nspname = ANY($1::text[])
GROUP BY n.nspname, t.typname ORDER BY n.nspname COLLATE "C", t.typname COLLATE "C"`;

const MIGRATIONS_SQL = `/* inventory:migrations */
SELECT id::text AS id, hash, created_at::text AS "createdAt"
FROM ONLY "drizzle"."__drizzle_migrations" ORDER BY id`;

function quoteIdentifier(identifier) {
  if (typeof identifier !== 'string' || !identifier.length || identifier.includes('\0')) {
    throw new InventoryError('INVALID_IDENTIFIER');
  }
  return `"${identifier.replaceAll('"', '""')}"`;
}

function qualified(object) {
  return `${quoteIdentifier(object.schema)}.${quoteIdentifier(object.name)}`;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function hash(value) {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

function ordered(items) {
  return [...items].sort((a, b) => {
    const left = canonical(a);
    const right = canonical(b);
    return left < right ? -1 : left > right ? 1 : 0;
  });
}

async function query(client, sql, parameters = []) {
  try {
    return (await client.query(sql, parameters)).rows;
  } catch {
    throw new InventoryError('QUERY_FAILED');
  }
}

let cursorSerial = 0;

async function digestTable(client, table, batchSize) {
  const cursor = quoteIdentifier(`ai_review_inventory_${++cursorSerial}`);
  const relation = qualified(table);
  const scope = table.kind === 'p' ? 'including-descendants' : 'only';
  const only = table.kind === 'p' ? '' : 'ONLY ';
  // Sort fixed-width SHA-256 strings with C collation. Identical rows remain duplicates.
  // JSONB canonicalizes object key order; UTC and output GUCs are checked before this query.
  await query(
    client,
    `/* inventory:row-hashes */ DECLARE ${cursor} NO SCROLL CURSOR WITHOUT HOLD FOR
     SELECT row_hash FROM (
       SELECT encode(sha256(convert_to(to_jsonb(record)::text, 'UTF8')), 'hex') AS row_hash
       FROM ${only}${relation} AS record
     ) AS hashes ORDER BY row_hash COLLATE "C"`,
  );
  const digest = createHash('sha256');
  digest.update(`${ALGORITHM}\n`);
  digest.update(`${canonical(table.columns.map(({ name, position }) => ({ name, position })))}\n`);
  let count = 0n;
  let previous = '';
  try {
    for (;;) {
      const rows = await query(client, `FETCH FORWARD ${batchSize} FROM ${cursor}`);
      if (!rows.length) break;
      for (const row of rows) {
        if (
          typeof row.row_hash !== 'string' ||
          !/^[a-f0-9]{64}$/.test(row.row_hash) ||
          row.row_hash < previous
        ) {
          throw new InventoryError('INVALID_ROW_HASH_STREAM');
        }
        previous = row.row_hash;
        digest.update(`${row.row_hash}\n`);
        count += 1n;
      }
    }
    return { count: count.toString(), sha256: digest.digest('hex'), scope };
  } finally {
    // The caller retains transaction ownership even on errors. Never rollback to hide failure.
    await query(client, `CLOSE ${cursor}`);
  }
}

/** @param {{ query: Function }} client A caller-owned, pinned node-postgres Client. */
export async function inventory(client, { batchSize = 2048 } = {}) {
  if (!client || typeof client.query !== 'function') throw new InventoryError('INVALID_CLIENT');
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 10000) {
    throw new InventoryError('INVALID_BATCH_SIZE');
  }
  const [session] = await query(client, SESSION_SQL);
  if (
    !session ||
    session.readOnly !== 'on' ||
    !['repeatable read', 'serializable'].includes(session.isolation)
  ) {
    throw new InventoryError('READ_ONLY_SNAPSHOT_REQUIRED');
  }
  if (Object.entries(SETTINGS).some(([name, value]) => session[name] !== value)) {
    throw new InventoryError('CANONICAL_SESSION_REQUIRED');
  }
  if (!/^\d+$/.test(session.serverVersion) || Number(session.serverVersion) < 170000) {
    throw new InventoryError('POSTGRES_17_OR_LATER_REQUIRED');
  }
  const presentSchemas = (
    await query(
      client,
      '/* inventory:schemas */ SELECT nspname AS name FROM pg_namespace WHERE nspname = ANY($1::text[]) ORDER BY nspname COLLATE "C"',
      [SCHEMAS],
    )
  ).map(({ name }) => name);
  const tables = await query(client, TABLES_SQL, [SCHEMAS]);
  if (tables.some((table) => table.kind === 'f')) {
    // A foreign table cannot be guaranteed to share this PostgreSQL snapshot.
    throw new InventoryError('FOREIGN_TABLE_UNSUPPORTED');
  }
  const columns = await query(client, COLUMNS_SQL, [SCHEMAS]);
  const constraints = await query(client, CONSTRAINTS_SQL, [SCHEMAS]);
  const indexes = await query(client, INDEXES_SQL, [SCHEMAS]);
  const sequences = await query(client, SEQUENCES_SQL, [SCHEMAS]);
  const enums = await query(client, ENUMS_SQL, [SCHEMAS]);
  let physicalRowCount = 0n;
  for (const table of tables) {
    const belongs = (item) => item.schema === table.schema && item.table === table.name;
    table.columns = columns.filter(belongs).sort((a, b) => a.position - b.position);
    table.constraints = ordered(constraints.filter((item) => belongs(item) && item.type !== 'n'));
    // PG18 represents named NOT NULLs in pg_constraint; PG17 may only have attnotnull.
    // Preserve and compare these separately; never silently waive a cross-version difference.
    table.namedNotNullConstraints = ordered(
      constraints.filter((item) => belongs(item) && item.type === 'n'),
    );
    table.indexes = ordered(indexes.filter(belongs));
    table.rows = await digestTable(client, table, batchSize);
    if (table.kind === 'r') physicalRowCount += BigInt(table.rows.count);
  }
  for (const sequence of sequences) {
    const [state] = await query(
      client,
      `/* inventory:sequence-state */ SELECT last_value::text AS "lastValue", is_called AS "isCalled" FROM ${qualified(sequence)}`,
    );
    if (!state || !/^-?\d+$/.test(state.lastValue) || typeof state.isCalled !== 'boolean') {
      throw new InventoryError('INVALID_SEQUENCE_STATE');
    }
    sequence.state = state;
  }
  const migrationTable = tables.find(
    (table) => table.schema === 'drizzle' && table.name === '__drizzle_migrations',
  );
  const migrations = {
    present: Boolean(migrationTable),
    entries: migrationTable ? await query(client, MIGRATIONS_SQL) : [],
  };
  return {
    formatVersion: FORMAT_VERSION,
    algorithm: ALGORITHM,
    serverVersion: session.serverVersion,
    schemas: [...SCHEMAS],
    presentSchemas: [...presentSchemas].sort(),
    physicalRowCount: physicalRowCount.toString(),
    tables: ordered(tables),
    sequences: ordered(sequences),
    enums: ordered(enums),
    migrations,
    caveats: [
      'Sequence state is not MVCC snapshot-consistent; quiesce writers before final verification.',
      'Partitioned parent counts include descendants; physicalRowCount counts ordinary tables only.',
      'This manifest is not a backup or a complete audit of roles, grants, policies, views, or functions.',
    ],
  };
}

/** Pure comparison; result contains only object identifiers, categories and aggregate hashes. */
export function compareInventories(source, target) {
  for (const manifest of [source, target]) {
    if (manifest?.formatVersion !== FORMAT_VERSION || manifest.algorithm !== ALGORITHM) {
      throw new InventoryError('INCOMPATIBLE_MANIFEST');
    }
  }
  const differences = [];
  function check(category, object, left, right) {
    if (canonical(left) !== canonical(right)) {
      differences.push({ category, object, sourceSha256: hash(left), targetSha256: hash(right) });
    }
  }
  function compareObjects(category, sourceItems, targetItems, inspect, missingCategory) {
    const key = (item) => JSON.stringify([item.schema, item.name]);
    const left = new Map(sourceItems.map((item) => [key(item), item]));
    const right = new Map(targetItems.map((item) => [key(item), item]));
    for (const id of [...new Set([...left.keys(), ...right.keys()])].sort()) {
      const a = left.get(id);
      const b = right.get(id);
      if (!a || !b) {
        check(category, id, a ?? null, b ?? null);
        if (missingCategory) check(missingCategory, id, Boolean(a), Boolean(b));
      } else inspect(id, a, b);
    }
  }
  check('structure', 'schema scope', source.schemas, target.schemas);
  check('structure', 'present schemas', source.presentSchemas, target.presentSchemas);
  check('data', 'physical row total', source.physicalRowCount, target.physicalRowCount);
  compareObjects(
    'structure',
    source.tables,
    target.tables,
    (id, a, b) => {
      const {
        rows: ar,
        rowSecurity: ars,
        forceRowSecurity: afrs,
        namedNotNullConstraints: ann,
        ...astruct
      } = a;
      const {
        rows: br,
        rowSecurity: brs,
        forceRowSecurity: bfrs,
        namedNotNullConstraints: bnn,
        ...bstruct
      } = b;
      check('structure', id, astruct, bstruct);
      check('data', id, ar, br);
      check('security', id, [ars, afrs], [brs, bfrs]);
      check('named-not-null', id, ann, bnn);
    },
    'data',
  );
  compareObjects(
    'structure',
    source.sequences,
    target.sequences,
    (id, a, b) => {
      const { state: astate, ...astruct } = a;
      const { state: bstate, ...bstruct } = b;
      check('structure', id, astruct, bstruct);
      check('sequence-state', id, astate, bstate);
    },
    'sequence-state',
  );
  check('structure', 'enums', ordered(source.enums), ordered(target.enums));
  check('migrations', 'drizzle migration history', source.migrations, target.migrations);
  const same = (category) => !differences.some((difference) => difference.category === category);
  return {
    matches: differences.length === 0,
    dataMatches: same('data'),
    structureMatches: same('structure'),
    securityMatches: same('security'),
    namedNotNullConstraintsMatch: same('named-not-null'),
    sequenceStateMatches: same('sequence-state'),
    migrationHistoryMatches: same('migrations'),
    sourceServerVersion: source.serverVersion,
    targetServerVersion: target.serverVersion,
    serverVersionsDiffer: source.serverVersion !== target.serverVersion,
    differences,
  };
}

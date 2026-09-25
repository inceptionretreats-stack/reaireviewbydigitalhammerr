/**
 * OFFLINE ONLY. Prepare a reviewable reset fragment; never opens a DB connection.
 * Input manifests and schema-only SQL are private, operator-supplied artifacts.
 * No source SQL is copied into the output or executed by this module.
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const APPLICATION_TABLES = Object.freeze([
  'password_reset_tokens',
  'sessions',
  'user_invites',
  'users',
  'assets',
  'business_links',
  'business_slugs',
  'businesses',
  'review_destinations',
  'anonymous_sessions',
  'qr_codes',
  'ai_business_contexts',
  'ai_generations',
  'ai_prompt_versions',
  'review_modes',
  'payment_webhook_events',
  'payments',
  'subscriptions',
  'customers',
  'private_feedback',
  'review_request_templates',
  'review_requests',
  'custom_domains',
  'analytics_daily_business',
  'analytics_events',
  'admin_audit_logs',
  'feature_flags',
  'platform_settings',
  'mfa_recovery_codes',
  'invoice_sequences',
  'payment_refunds',
  'subscription_reminders',
  'user_activity_logs',
]);
const ENUMS = [
  'qr_status',
  'user_role',
  'payment_status',
  'ai_prompt_status',
  'business_status',
  'subscription_status',
  'link_type',
  'feedback_status',
  'entitlement_source',
  'customer_request_status',
  'domain_status',
  'draft_language',
];
const FUNCTIONS = [
  'public.ensure_analytics_events_partition(date)',
  'public.reset_pro_quota_on_period_change()',
];
const TRIGGER = 'public.subscriptions.trg_reset_pro_quota_on_period_change';
const SEQUENCES = [
  ['drizzle', '__drizzle_migrations', 'a'],
  ['public', 'admin_audit_logs', 'i'],
  ['public', 'analytics_events', 'i'],
  ['public', 'user_activity_logs', 'i'],
];
const SHA = /^[a-f0-9]{64}$/;
const NAME = /^[a-z_][a-z0-9_]{0,62}$/;
const PARTITION = /^analytics_events_(?:[0-9]{4}_(?:0[1-9]|1[0-2])|default)$/;
const id = (value) => `"${value}"`;
const key = (value) => `${value.schema}.${value.name}`;
const qualified = (value) => `${id(value.schema)}.${id(value.name)}`;
const literal = (value) => `'${value.replaceAll("'", "''")}'`;
const jsonLiteral = (value) => {
  const serialized = JSON.stringify(value);
  requireCondition(
    !serialized.includes('$inventory_guard$') && !serialized.includes('\\u0000'),
    'unsafe-catalog-metadata',
  );
  return `${literal(serialized)}::jsonb`;
};
const sorted = (values) => [...values].sort();
const equalSet = (left, right) => JSON.stringify(sorted(left)) === JSON.stringify(sorted(right));

export class RefreshPlanError extends Error {
  constructor(code) {
    super(`Refresh preparation stopped (${code}). No database action was performed.`);
    this.name = 'RefreshPlanError';
    this.code = code;
  }
}
function requireCondition(condition, code) {
  if (!condition) throw new RefreshPlanError(code);
}
function unique(values, code) {
  requireCondition(new Set(values).size === values.length, code);
}
function validateName(value) {
  requireCondition(typeof value === 'string' && NAME.test(value), 'invalid-identifier');
}
function validateManifest(manifest) {
  requireCondition(
    manifest?.formatVersion === 1 && manifest.algorithm === 'sha256-sorted-jsonb-row-hashes-v1',
    'manifest-format',
  );
  requireCondition(
    Array.isArray(manifest.schemas) && equalSet(manifest.schemas, ['public', 'drizzle']),
    'schema-scope',
  );
  requireCondition(
    Array.isArray(manifest.tables) &&
      Array.isArray(manifest.sequences) &&
      Array.isArray(manifest.enums),
    'manifest-collections',
  );
  unique(manifest.tables.map(key), 'duplicate-table');
  const required = APPLICATION_TABLES.map((name) => `public.${name}`).concat(
    'drizzle.__drizzle_migrations',
  );
  const names = manifest.tables.map(key);
  requireCondition(
    required.every((name) => names.includes(name)),
    'required-table-missing',
  );
  for (const table of manifest.tables) {
    validateName(table.schema);
    validateName(table.name);
    requireCondition(table.persistence === 'p' && ['r', 'p'].includes(table.kind), 'table-kind');
    requireCondition(
      Array.isArray(table.parents) &&
        Array.isArray(table.indexes) &&
        Array.isArray(table.columns) &&
        Array.isArray(table.constraints) &&
        Array.isArray(table.namedNotNullConstraints),
      'table-metadata',
    );
    const partition = table.schema === 'public' && PARTITION.test(table.name);
    requireCondition(
      required.includes(key(table)) || key(table) === 'public.maintenance_jobs' || partition,
      'unknown-table',
    );
    if (partition) {
      requireCondition(
        table.isPartition === true &&
          table.kind === 'r' &&
          table.parents.length === 1 &&
          table.parents[0].schema === 'public' &&
          table.parents[0].name === 'analytics_events' &&
          table.parents[0].position === 1 &&
          typeof table.partitionBound === 'string',
        'partition-ownership',
      );
    } else {
      requireCondition(
        table.isPartition === false && table.parents.length === 0 && table.partitionBound === null,
        'unexpected-inheritance',
      );
      requireCondition(
        table.kind === (table.name === 'analytics_events' ? 'p' : 'r'),
        'partition-parent-kind',
      );
    }
    for (const index of table.indexes) {
      validateName(index.name);
      requireCondition(
        index.schema === table.schema &&
          index.table === table.name &&
          ['i', 'I'].includes(index.kind),
        'index-ownership',
      );
    }
    for (const column of table.columns) {
      validateName(column.name);
      requireCondition(
        column.schema === table.schema &&
          column.table === table.name &&
          Number.isInteger(column.position) &&
          column.position > 0 &&
          typeof column.type === 'string' &&
          typeof column.notNull === 'boolean',
        'column-metadata',
      );
    }
    for (const constraint of [...table.constraints, ...table.namedNotNullConstraints]) {
      validateName(constraint.name);
      requireCondition(
        constraint.schema === table.schema &&
          constraint.table === table.name &&
          /^[cfnpux]$/.test(constraint.type),
        'constraint-metadata',
      );
    }
    requireCondition(
      SHA.test(table.rows?.sha256) && /^\d+$/.test(table.rows?.count),
      'row-digest-missing',
    );
  }
  const sequenceKeys = SEQUENCES.map(([schema, table]) => `${schema}.${table}_id_seq`);
  requireCondition(equalSet(manifest.sequences.map(key), sequenceKeys), 'sequence-scope');
  for (const [schema, table, dependency] of SEQUENCES) {
    const sequence = manifest.sequences.find((item) => key(item) === `${schema}.${table}_id_seq`);
    requireCondition(
      sequence.ownedBy?.length === 1 &&
        sequence.ownedBy[0].schema === schema &&
        sequence.ownedBy[0].table === table &&
        sequence.ownedBy[0].column === 'id' &&
        sequence.ownedBy[0].dependency === dependency,
      'sequence-ownership',
    );
  }
  requireCondition(
    equalSet(
      manifest.enums.map(key),
      ENUMS.map((name) => `public.${name}`),
    ),
    'enum-scope',
  );
  requireCondition(
    manifest.migrations?.present === true &&
      Array.isArray(manifest.migrations.entries) &&
      manifest.migrations.entries.length > 0,
    'migration-history-missing',
  );
  return manifest;
}

/** Inspect pg_dump schema-only TOC headers, never interpreting/executing their SQL bodies. */
export function inspectSchemaOnly(schemaSql, sourceManifest) {
  requireCondition(
    typeof schemaSql === 'string' && schemaSql.length < 8 * 1024 * 1024,
    'schema-file-size',
  );
  requireCondition(
    !/^COPY .* FROM stdin;|^INSERT INTO |^-- .*Type: (?:TABLE DATA|SEQUENCE SET);/m.test(schemaSql),
    'not-schema-only',
  );
  const entries = [
    ...schemaSql.matchAll(
      /^-- Name: (.+); Type: ([A-Z ]+); Schema: ([^;]+); Owner: [^\r\n]+\r?$/gm,
    ),
  ].map((match) => ({ name: match[1].replaceAll('"', ''), type: match[2], schema: match[3] }));
  requireCondition(entries.length > 0, 'schema-toc-missing');
  const tables = sourceManifest.tables.map(key);
  const sequences = sourceManifest.sequences.map(key);
  const indexes = sourceManifest.tables.flatMap((table) => table.indexes.map(key));
  for (const entry of entries) {
    const object = `${entry.schema}.${entry.name}`;
    switch (entry.type) {
      case 'SCHEMA':
        requireCondition(
          entry.schema === '-' && ['public', 'drizzle'].includes(entry.name),
          'unknown-schema',
        );
        break;
      case 'COMMENT':
        requireCondition(entry.schema === '-' && entry.name === 'SCHEMA public', 'unknown-comment');
        break;
      case 'TABLE':
      case 'TABLE ATTACH':
        requireCondition(tables.includes(object), 'schema-table-mismatch');
        break;
      case 'TYPE':
        requireCondition(ENUMS.map((name) => `public.${name}`).includes(object), 'unknown-type');
        break;
      case 'SEQUENCE':
      case 'SEQUENCE OWNED BY':
        requireCondition(sequences.includes(object), 'unknown-sequence');
        break;
      case 'FUNCTION':
        requireCondition(FUNCTIONS.includes(object), 'unknown-function');
        break;
      case 'TRIGGER':
        requireCondition(object === TRIGGER.replace('.trg_', ' trg_'), 'unknown-trigger');
        break;
      case 'INDEX':
      case 'INDEX ATTACH':
        requireCondition(indexes.includes(object), 'unknown-index');
        break;
      case 'DEFAULT':
      case 'CONSTRAINT':
      case 'CHECK CONSTRAINT':
      case 'FK CONSTRAINT':
        requireCondition(
          tables.includes(`${entry.schema}.${entry.name.split(' ')[0]}`),
          'unknown-table-component',
        );
        break;
      default:
        throw new RefreshPlanError('unreviewed-schema-object');
    }
  }
  const ofType = (type) =>
    entries.filter((entry) => entry.type === type).map((entry) => `${entry.schema}.${entry.name}`);
  requireCondition(
    equalSet(ofType('TABLE'), tables) &&
      equalSet(ofType('SEQUENCE'), sequences) &&
      equalSet(ofType('TYPE'), sourceManifest.enums.map(key)) &&
      equalSet(ofType('FUNCTION'), FUNCTIONS) &&
      equalSet(ofType('TRIGGER'), [TRIGGER.replace('.trg_', ' trg_')]),
    'schema-manifest-mismatch',
  );
  return { functions: [...FUNCTIONS], triggers: [TRIGGER] };
}

const EXTENSION_MEMBER = (catalog, oid) =>
  `EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = '${catalog}'::regclass AND d.objid = ${oid} AND d.deptype = 'e')`;
function catalogGuard(query, expected, code) {
  return `  SELECT COALESCE(jsonb_agg(v ORDER BY v::text COLLATE "C"), '[]'::jsonb) INTO observed FROM (${query}) AS q(v);
  IF observed IS DISTINCT FROM (SELECT COALESCE(jsonb_agg(v ORDER BY v::text COLLATE "C"), '[]'::jsonb) FROM jsonb_array_elements(${jsonLiteral(expected)}) AS e(v)) THEN
    RAISE EXCEPTION 'AI Review refresh guard: ${code}';
  END IF;`;
}

/** Pure plan builder. The caller must verify artifact digests before considering execution. */
export function buildRefreshPlan({
  sourceManifest,
  targetManifest,
  schemaSql,
  archiveSha256,
  targetProjectRef,
}) {
  requireCondition(SHA.test(archiveSha256), 'archive-sha256');
  requireCondition(/^[a-z]{20}$/.test(targetProjectRef), 'target-project-reference');
  const source = validateManifest(sourceManifest);
  const target = validateManifest(targetManifest);
  inspectSchemaOnly(schemaSql, source);
  const relations = target.tables
    .flatMap((table) => [
      `${key(table)}:${table.kind}`,
      ...table.indexes.map((index) => `${key(index)}:${index.kind}`),
    ])
    .concat(target.sequences.map((sequence) => `${key(sequence)}:S`));
  unique(relations, 'duplicate-relation');
  const topTables = target.tables
    .filter((table) => !table.isPartition)
    .sort((a, b) => key(a).localeCompare(key(b), 'en'));
  const allTables = sorted(target.tables.map(qualified));
  const guards = [
    catalogGuard(
      `SELECT to_jsonb(n.nspname || '.' || c.relname || ':' || c.relkind::text) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname IN ('public', 'drizzle') AND NOT ${EXTENSION_MEMBER('pg_class', 'c.oid')}`,
      relations,
      'relation inventory changed',
    ),
    catalogGuard(
      `SELECT jsonb_build_object('table', n.nspname || '.' || c.relname,
        'position', a.attnum, 'name', a.attname, 'type', format_type(a.atttypid, a.atttypmod), 'notNull', a.attnotnull)
      FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname IN ('public','drizzle') AND c.relkind IN ('r','p') AND a.attnum > 0 AND NOT a.attisdropped
        AND NOT ${EXTENSION_MEMBER('pg_class', 'c.oid')}`,
      target.tables.flatMap((table) =>
        table.columns.map((column) => ({
          table: key(table),
          position: column.position,
          name: column.name,
          type: column.type,
          notNull: column.notNull,
        })),
      ),
      'column inventory changed',
    ),
    catalogGuard(
      `SELECT to_jsonb(n.nspname || '.' || c.relname || '.' || con.conname || ':' || con.contype::text)
      FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname IN ('public','drizzle') AND NOT ${EXTENSION_MEMBER('pg_class', 'c.oid')}`,
      target.tables.flatMap((table) =>
        [...table.constraints, ...table.namedNotNullConstraints].map(
          (constraint) => `${key(table)}.${constraint.name}:${constraint.type}`,
        ),
      ),
      'constraint inventory changed',
    ),
    catalogGuard(
      `SELECT to_jsonb(n.nspname || '.' || p.proname || '(' || oidvectortypes(p.proargtypes) || ')') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname IN ('public', 'drizzle') AND NOT ${EXTENSION_MEMBER('pg_proc', 'p.oid')}`,
      FUNCTIONS,
      'function inventory changed',
    ),
    catalogGuard(
      `SELECT to_jsonb(n.nspname || '.' || t.typname || ':' || t.typtype::text) FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname IN ('public', 'drizzle') AND t.typrelid = 0 AND t.typelem = 0 AND NOT ${EXTENSION_MEMBER('pg_type', 't.oid')}`,
      target.enums.map((item) => `${key(item)}:e`),
      'type inventory changed',
    ),
    catalogGuard(
      `SELECT to_jsonb(n.nspname || '.' || c.relname || '.' || t.tgname) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname IN ('public', 'drizzle') AND NOT t.tgisinternal AND NOT ${EXTENSION_MEMBER('pg_class', 'c.oid')}`,
      [TRIGGER],
      'trigger inventory changed',
    ),
    catalogGuard(
      `SELECT jsonb_build_object('child', cn.nspname || '.' || child.relname, 'parent', pn.nspname || '.' || parent.relname,
        'bound', pg_get_expr(child.relpartbound, child.oid, false)) FROM pg_inherits inh
      JOIN pg_class child ON child.oid = inh.inhrelid JOIN pg_namespace cn ON cn.oid = child.relnamespace
      JOIN pg_class parent ON parent.oid = inh.inhparent JOIN pg_namespace pn ON pn.oid = parent.relnamespace
      WHERE parent.relkind IN ('r', 'p') AND (pn.nspname IN ('public', 'drizzle') OR cn.nspname IN ('public', 'drizzle'))`,
      target.tables
        .filter((table) => table.isPartition)
        .map((table) => ({
          child: key(table),
          parent: 'public.analytics_events',
          bound: table.partitionBound,
        })),
      'partition inventory changed',
    ),
    catalogGuard(
      `SELECT to_jsonb(sn.nspname || '.' || s.relname || '->' || tn.nspname || '.' || t.relname || '.' || a.attname || ':' || d.deptype::text)
      FROM pg_class s JOIN pg_namespace sn ON sn.oid = s.relnamespace
      JOIN pg_depend d ON d.classid = 'pg_class'::regclass AND d.objid = s.oid AND d.refclassid = 'pg_class'::regclass AND d.deptype IN ('a','i')
      JOIN pg_class t ON t.oid = d.refobjid JOIN pg_namespace tn ON tn.oid = t.relnamespace
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
      WHERE s.relkind = 'S' AND (sn.nspname IN ('public','drizzle') OR tn.nspname IN ('public','drizzle'))`,
      target.sequences.map((sequence) => {
        const owner = sequence.ownedBy[0];
        return `${key(sequence)}->${owner.schema}.${owner.table}.${owner.column}:${owner.dependency}`;
      }),
      'sequence ownership changed',
    ),
  ];
  const sql = `-- AI Review FINAL REFRESH RESET FRAGMENT — REVIEW BEFORE EXECUTION.
-- Archive SHA-256: ${archiveSha256}
-- Expected Supabase project: ${targetProjectRef} (the caller MUST verify the TLS endpoint separately).
-- No BEGIN/COMMIT here: execute inside ONE outer transaction with restore and validation.
-- A standalone LOCK TABLE fails outside an explicit transaction. Do not use autocommit.
-- Operator must SET LOCAL ai_review.refresh_approved_sha256 and ai_review.refresh_target_project
-- to the values above ONLY AFTER source writes are fenced and target backup/hash comparison passes.
-- Preserve public/drizzle namespaces, extensions, managed schemas, roles, and unrelated objects.
DO $approval$
BEGIN
  IF current_database() <> 'postgres' OR
     NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'auth') OR
     NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'storage') OR
     NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') OR
     NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') OR
     NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') OR
     current_setting('ai_review.refresh_approved_sha256', true) IS DISTINCT FROM '${archiveSha256}' OR
     current_setting('ai_review.refresh_target_project', true) IS DISTINCT FROM '${targetProjectRef}' THEN
    RAISE EXCEPTION 'AI Review refresh guard: target or explicit approval missing';
  END IF;
  PERFORM set_config('lock_timeout', '10s', true);
  PERFORM set_config('statement_timeout', '60s', true);
  PERFORM set_config('standard_conforming_strings', 'on', true);
  PERFORM set_config('search_path', 'pg_catalog', true);
END
$approval$;

LOCK TABLE ${allTables.join(',\n  ')} IN ACCESS EXCLUSIVE MODE;

DO $inventory_guard$
DECLARE observed jsonb;
BEGIN
${guards.join('\n')}
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('public','drizzle') AND c.relkind IN ('r','p','S')
      AND NOT ${EXTENSION_MEMBER('pg_class', 'c.oid')} AND c.relowner <> (SELECT oid FROM pg_roles WHERE rolname = current_user)) THEN
    RAISE EXCEPTION 'AI Review refresh guard: application owner mismatch';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('public','drizzle') AND NOT ${EXTENSION_MEMBER('pg_class', 'c.oid')}) OR
     EXISTS (SELECT 1 FROM pg_rewrite r JOIN pg_class c ON c.oid = r.ev_class JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('public','drizzle') AND NOT ${EXTENSION_MEMBER('pg_class', 'c.oid')}) OR
     EXISTS (SELECT 1 FROM pg_publication_rel r JOIN pg_class c ON c.oid = r.prrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('public','drizzle') AND NOT ${EXTENSION_MEMBER('pg_class', 'c.oid')}) THEN
    RAISE EXCEPTION 'AI Review refresh guard: unreviewed policy, rule, or publication';
  END IF;
END
$inventory_guard$;

-- One exact list resolves internal cyclic foreign keys. Owned sequences, indexes,
-- constraints, the known subscription trigger, and verified partitions follow their tables.
-- RESTRICT makes dependencies outside the reviewed set abort the entire transaction.
DROP TABLE ${topTables.map(qualified).join(',\n  ')} RESTRICT;
DROP FUNCTION "public"."ensure_analytics_events_partition"(date),
  "public"."reset_pro_quota_on_period_change"() RESTRICT;
DROP TYPE ${sorted(target.enums.map(qualified)).join(',\n  ')} RESTRICT;
-- DO NOT COMMIT HERE. Apply the verified filtered archive in this same transaction.
`;
  return {
    sql,
    review: {
      formatVersion: 1,
      offlinePreparationOnly: true,
      archiveSha256,
      targetProjectRef,
      resetTables: topTables.map(key),
      dependentPartitions: target.tables.filter((table) => table.isPartition).map(key),
      functions: [...FUNCTIONS],
      triggerRemovedWithTable: TRIGGER,
      ownedSequencesRemovedWithTables: target.sequences.map(key),
      enumTypes: target.enums.map(key),
      preserveSchemas: ['public', 'drizzle', 'all managed schemas'],
      archiveTocExclusions: [
        'SCHEMA public',
        'COMMENT SCHEMA public',
        'SCHEMA drizzle',
        'COMMENT SCHEMA drizzle (if present)',
      ],
      requiredExecutionChecks: [
        'Obtain explicit live-cutover approval; fence all source and target writers, old deployments, cron and workers.',
        'Back up the target before resetting it. Re-inventory the fenced target and compare data/schema/sequences against the supplied target manifest; this SQL checks catalog scope, not row digests.',
        'Verify TLS hostname/project/database independently; SQL approval settings are operator acknowledgments, not remote identity proofs.',
        'Verify all four input hashes again at execution. Confirm manifest and schema-only extraction came from this fresh archive/snapshot; independent hashes alone do not prove provenance or freshness.',
        'Review server-wide event triggers and block concurrent privileged DDL; table locks do not prevent new objects appearing in a schema.',
        'Use one pinned connection and explicit outer transaction. Set approval GUCs LOCAL, execute reset fragment, restore prerequisites and the archive filtered by TOC object identities (never hardcoded TOC IDs), then validate before COMMIT.',
        'Do not execute source-schema.sql directly. Preserve the already-existing drizzle/public schemas by filtering their CREATE/COMMENT entries; retain all application data and sequence-set entries.',
        'The current lock-down.sql has its own BEGIN/COMMIT: do not nest it unchanged in the reset/restore transaction. Reapply pending migrations and hardening while the target remains fenced, using reviewed transaction-safe wrappers.',
        'Abort and roll back on any error or discrepancy. Do not add broad dependency-removal options to force progress.',
      ],
    },
  };
}

async function checkedArtifact(
  filePath,
  expectedSha,
  { text = false, maxBytes = 8 * 1024 * 1024 } = {},
) {
  requireCondition(
    typeof filePath === 'string' && path.isAbsolute(filePath) && SHA.test(expectedSha),
    'artifact-arguments',
  );
  const info = await stat(filePath);
  requireCondition(
    info.isFile() && info.size > 0 && (!text || info.size <= maxBytes),
    'artifact-file',
  );
  const hash = createHash('sha256');
  let firstChunk = true;
  for await (const chunk of createReadStream(filePath)) {
    if (firstChunk && !text) {
      requireCondition(chunk.subarray(0, 5).toString('ascii') === 'PGDMP', 'archive-format');
    }
    firstChunk = false;
    hash.update(chunk);
  }
  requireCondition(hash.digest('hex') === expectedSha, 'artifact-hash-mismatch');
  if (!text) return undefined;
  const bytes = await readFile(filePath);
  requireCondition(
    createHash('sha256').update(bytes).digest('hex') === expectedSha,
    'artifact-changed',
  );
  return bytes.toString('utf8');
}
function isWithin(parent, child) {
  const relative = path.relative(parent, child);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
}

/**
 * Explicit file API; no CLI/env initialization. Digests must be independently reviewed.
 * outputDirectory must already exist outside workspaceRoot. Existing plans are never overwritten.
 * Errors contain only stable codes, never input text, file content, or connection information.
 */
export async function prepareRefresh(options) {
  try {
    const {
      archivePath,
      archiveSha256,
      sourceManifestPath,
      sourceManifestSha256,
      targetManifestPath,
      targetManifestSha256,
      schemaPath,
      schemaSha256,
      targetProjectRef,
      outputDirectory,
      workspaceRoot,
    } = options;
    requireCondition(
      path.isAbsolute(outputDirectory) && path.isAbsolute(workspaceRoot),
      'output-path',
    );
    const output = await realpath(outputDirectory);
    const workspace = await realpath(workspaceRoot);
    requireCondition(
      (await stat(output)).isDirectory() && !isWithin(workspace, output),
      'private-output-required',
    );
    await checkedArtifact(archivePath, archiveSha256);
    const source = await checkedArtifact(sourceManifestPath, sourceManifestSha256, { text: true });
    const target = await checkedArtifact(targetManifestPath, targetManifestSha256, { text: true });
    const schemaSql = await checkedArtifact(schemaPath, schemaSha256, { text: true });
    const result = buildRefreshPlan({
      sourceManifest: JSON.parse(source),
      targetManifest: JSON.parse(target),
      schemaSql,
      archiveSha256,
      targetProjectRef,
    });
    const sqlPath = path.join(output, `refresh-reset-${archiveSha256}.sql`);
    const reviewPath = path.join(output, `refresh-review-${archiveSha256}.json`);
    result.review.inputDigests = {
      archiveSha256,
      sourceManifestSha256,
      targetManifestSha256,
      schemaSha256,
    };
    // A partial pair is intentionally never reused/overwritten after an interrupted preparation.
    await writeFile(sqlPath, result.sql, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    await writeFile(reviewPath, JSON.stringify(result.review, null, 2) + '\n', {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    return {
      sqlPath,
      reviewPath,
      sqlSha256: createHash('sha256').update(result.sql).digest('hex'),
    };
  } catch (error) {
    if (error instanceof RefreshPlanError) throw error;
    throw new RefreshPlanError('artifact-io-or-format');
  }
}

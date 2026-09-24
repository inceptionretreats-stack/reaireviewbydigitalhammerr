import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { APPLICATION_TABLES, buildRefreshPlan, prepareRefresh } from '../prepare-refresh.mjs';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const HASH = 'a'.repeat(64);
const PROJECT = 'a'.repeat(20);
const enumNames = [
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
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function table(schema: string, name: string) {
  return {
    schema,
    name,
    kind: name === 'analytics_events' ? 'p' : 'r',
    persistence: 'p',
    isPartition: false,
    parents: [] as { schema: string; name: string; position: number }[],
    partitionBound: null as string | null,
    columns: [{ schema, table: name, name: 'id', position: 1, type: 'integer', notNull: true }],
    constraints: [],
    namedNotNullConstraints: [],
    indexes: [
      { schema, table: name, name: `${name}_pkey`, kind: name === 'analytics_events' ? 'I' : 'i' },
    ],
    rows: { count: '0', sha256: HASH },
  };
}
function fixture() {
  const tables = APPLICATION_TABLES.map((name: string) => table('public', name));
  tables.push(table('drizzle', '__drizzle_migrations'));
  tables.push({
    ...table('public', 'analytics_events_2026_09'),
    isPartition: true,
    parents: [{ schema: 'public', name: 'analytics_events', position: 1 }],
    partitionBound: "FOR VALUES FROM ('2026-09-01') TO ('2026-10-01')",
  });
  const source = {
    formatVersion: 1,
    algorithm: 'sha256-sorted-jsonb-row-hashes-v1',
    schemas: ['public', 'drizzle'],
    tables,
    sequences: [
      ['drizzle', '__drizzle_migrations', 'a'],
      ['public', 'admin_audit_logs', 'i'],
      ['public', 'analytics_events', 'i'],
      ['public', 'user_activity_logs', 'i'],
    ].map(([schema, name, dependency]) => ({
      schema,
      name: `${name}_id_seq`,
      ownedBy: [{ schema, table: name, column: 'id', dependency }],
    })),
    enums: enumNames.map((name) => ({ schema: 'public', name })),
    migrations: { present: true, entries: [{ id: 1, hash: HASH, createdAt: '1' }] },
  };
  const target = structuredClone(source);
  target.tables.push(table('public', 'maintenance_jobs'));
  const header = (name: string, type: string, schema: string) =>
    `-- Name: ${name}; Type: ${type}; Schema: ${schema}; Owner: -`;
  const schemaSql = [
    header('public', 'SCHEMA', '-'),
    header('drizzle', 'SCHEMA', '-'),
    header('SCHEMA "public"', 'COMMENT', '-'),
    ...source.tables.map((item) => header(item.name, 'TABLE', item.schema)),
    ...source.sequences.map((item) => header(item.name, 'SEQUENCE', item.schema)),
    ...source.enums.map((item) => header(item.name, 'TYPE', item.schema)),
    header('ensure_analytics_events_partition("date")', 'FUNCTION', 'public'),
    header('reset_pro_quota_on_period_change()', 'FUNCTION', 'public'),
    header('subscriptions trg_reset_pro_quota_on_period_change', 'TRIGGER', 'public'),
  ].join('\n');
  return {
    sourceManifest: source,
    targetManifest: target,
    schemaSql,
    archiveSha256: HASH,
    targetProjectRef: PROJECT,
  };
}

describe('offline restrictive final refresh plan', () => {
  it('drops only reviewed application tables, then functions, then enum types', () => {
    const result = buildRefreshPlan(fixture());
    expect(result.sql).toContain('"public"."maintenance_jobs"');
    expect(result.sql).not.toMatch(
      /\bCASCADE\b|DROP SCHEMA|DROP EXTENSION|DROP ROLE|TRUNCATE|\nBEGIN;|\nCOMMIT;/,
    );
    const drop = result.sql.slice(result.sql.indexOf('DROP TABLE'));
    expect(drop).not.toContain('"public"."analytics_events_2026_09"');
    expect(drop).toContain('"public"."analytics_events"');
    expect(drop.indexOf('DROP TABLE')).toBeLessThan(drop.indexOf('DROP FUNCTION'));
    expect(drop.indexOf('DROP FUNCTION')).toBeLessThan(drop.indexOf('DROP TYPE'));
    expect(drop.match(/ RESTRICT;/g)).toHaveLength(3);
    expect(result.review.dependentPartitions).toEqual(['public.analytics_events_2026_09']);
    expect(result.review.archiveTocExclusions).toContain('SCHEMA drizzle');
  });
  it('requires approval, explicit transaction lock, catalog guards, and restrictive dependencies', () => {
    const { sql, review } = buildRefreshPlan(fixture());
    expect(sql).toContain("current_database() <> 'postgres'");
    expect(sql).toContain("current_setting('ai_review.refresh_approved_sha256', true)");
    expect(sql).toContain('LOCK TABLE');
    expect(sql).toContain('IN ACCESS EXCLUSIVE MODE');
    expect(sql).toContain('relation inventory changed');
    expect(sql).toContain('column inventory changed');
    expect(sql).toContain('constraint inventory changed');
    expect(sql).toContain('function inventory changed');
    expect(sql).toContain('type inventory changed');
    expect(sql).toContain('partition inventory changed');
    expect(sql).toContain('sequence ownership changed');
    expect(sql).toContain('pg_policy');
    expect(sql).toContain('pg_publication_rel');
    expect(sql).toContain('application owner mismatch');
    expect(sql.indexOf('LOCK TABLE')).toBeLessThan(sql.indexOf('DROP TABLE'));
    expect(review.requiredExecutionChecks.join(' ')).toContain('not row digests');
    expect(review.requiredExecutionChecks.join(' ')).toContain(
      'do not prove provenance or freshness',
    );
  });
  it.each(['c.relkind', 'con.contype', 't.typtype', 'd.deptype'])(
    'casts PostgreSQL internal char catalog field %s before text concatenation',
    (field) => {
      const { sql } = buildRefreshPlan(fixture());
      // PG17 cannot choose an unambiguous || overload for text and its internal "char" type.
      const escaped = field.replaceAll('.', '\\.');
      expect(sql).toMatch(new RegExp(`\\|\\|\\s*${escaped}::text\\b`));
      expect(sql).not.toMatch(new RegExp(`\\|\\|\\s*${escaped}(?!::text)\\b`));
    },
  );
  it('never includes input SQL bodies or row metadata in output', () => {
    const input = fixture();
    input.schemaSql += '\n-- private example string not copied\n';
    input.sourceManifest.tables[0].rows.count = '918234';
    const output = JSON.stringify(buildRefreshPlan(input));
    expect(output).not.toContain('private example string');
    expect(output).not.toContain('918234');
  });
  it.each(['TABLE DATA', 'VIEW', 'MATERIALIZED VIEW', 'POLICY', 'EVENT TRIGGER', 'EXTENSION'])(
    'rejects unreviewed source %s entries',
    (type) => {
      const input = fixture();
      input.schemaSql += `\n-- Name: unexpected; Type: ${type}; Schema: public; Owner: -\n`;
      expect(() => buildRefreshPlan(input)).toThrow(/not-schema-only|unreviewed-schema-object/);
    },
  );
  it.each(['FUNCTION', 'TRIGGER', 'TABLE', 'TYPE', 'SEQUENCE', 'INDEX'])(
    'rejects unknown source %s object',
    (type) => {
      const input = fixture();
      input.schemaSql += `\n-- Name: unexpected; Type: ${type}; Schema: public; Owner: -\n`;
      expect(() => buildRefreshPlan(input)).toThrow();
    },
  );
  it.each(['sourceManifest', 'targetManifest'] as const)(
    'rejects unknown or missing tables in %s',
    (field) => {
      const unknown = fixture();
      unknown[field].tables.push(table('public', 'another_application'));
      expect(() => buildRefreshPlan(unknown)).toThrow(/unknown-table/);
      const missing = fixture();
      missing[field].tables = missing[field].tables.filter((item) => item.name !== 'users');
      expect(() => buildRefreshPlan(missing)).toThrow(/required-table-missing/);
    },
  );
  it('rejects malformed names, duplicate relations, missing hashes, and foreign tables', () => {
    for (const mutate of [
      (input: ReturnType<typeof fixture>) => {
        input.targetManifest.tables[0].name = 'users";DROP SCHEMA auth';
      },
      (input: ReturnType<typeof fixture>) => {
        input.targetManifest.tables.push(input.targetManifest.tables[0]);
      },
      (input: ReturnType<typeof fixture>) => {
        input.targetManifest.tables[0].rows.sha256 = '';
      },
      (input: ReturnType<typeof fixture>) => {
        input.targetManifest.tables[0].kind = 'f';
      },
    ]) {
      const input = fixture();
      mutate(input);
      expect(() => buildRefreshPlan(input)).toThrow();
    }
  });
  it('rejects unmanaged inheritance, unowned sequence and unknown type', () => {
    const inheritance = fixture();
    inheritance.targetManifest.tables.at(-2)!.parents[0].schema = 'other_app';
    expect(() => buildRefreshPlan(inheritance)).toThrow(/partition-ownership/);
    const sequence = fixture();
    sequence.targetManifest.sequences[0].ownedBy = [];
    expect(() => buildRefreshPlan(sequence)).toThrow(/sequence-ownership/);
    const type = fixture();
    type.targetManifest.enums.push({ schema: 'public', name: 'another_type' });
    expect(() => buildRefreshPlan(type)).toThrow(/enum-scope/);
  });
  it('accepts target-only known maintenance table and differing reviewed partition months', () => {
    const input = fixture();
    const partition = input.targetManifest.tables.at(-2)!;
    partition.name = 'analytics_events_2026_10';
    partition.indexes[0].table = partition.name;
    partition.indexes[0].name = `${partition.name}_pkey`;
    partition.columns[0].table = partition.name;
    expect(buildRefreshPlan(input).review.dependentPartitions).toEqual([
      'public.analytics_events_2026_10',
    ]);
  });
  it('rejects a mismatched schema-only inventory and any source data copy', () => {
    const input = fixture();
    input.schemaSql = input.schemaSql.replace(
      '-- Name: users; Type: TABLE; Schema: public; Owner: -',
      '',
    );
    expect(() => buildRefreshPlan(input)).toThrow(/schema-manifest-mismatch/);
    const data = fixture();
    data.schemaSql += '\nCOPY public.users (id) FROM stdin;\n';
    expect(() => buildRefreshPlan(data)).toThrow(/not-schema-only/);
  });
  it('requires explicit SHA-256 and project reference', () => {
    expect(() => buildRefreshPlan({ ...fixture(), archiveSha256: 'not-a-hash' })).toThrow(
      /archive-sha256/,
    );
    expect(() => buildRefreshPlan({ ...fixture(), targetProjectRef: "x'; SELECT 1" })).toThrow(
      /target-project-reference/,
    );
  });
  it('rejects catalog metadata that could terminate the guarded SQL body', () => {
    const input = fixture();
    input.targetManifest.tables[0].columns[0].type = '$inventory_guard$';
    expect(() => buildRefreshPlan(input)).toThrow(/unsafe-catalog-metadata/);
  });
});

async function artifacts() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ai-review-refresh-test-'));
  directories.push(directory);
  const fixtureData = fixture();
  const values = {
    archive: 'PGDMP offline fake archive fixture',
    sourceManifest: JSON.stringify(fixtureData.sourceManifest),
    targetManifest: JSON.stringify(fixtureData.targetManifest),
    schema: fixtureData.schemaSql,
  };
  const paths = Object.fromEntries(
    Object.keys(values).map((key) => [key, path.join(directory, `${key}.fixture`)]),
  );
  await Promise.all(Object.entries(values).map(([key, value]) => writeFile(paths[key], value)));
  return {
    archivePath: paths.archive,
    archiveSha256: digest(values.archive),
    sourceManifestPath: paths.sourceManifest,
    sourceManifestSha256: digest(values.sourceManifest),
    targetManifestPath: paths.targetManifest,
    targetManifestSha256: digest(values.targetManifest),
    schemaPath: paths.schema,
    schemaSha256: digest(values.schema),
    targetProjectRef: PROJECT,
    outputDirectory: directory,
    workspaceRoot: process.cwd(),
  };
}
describe('private artifact preparation without database access', () => {
  it('verifies all artifact hashes and writes a non-overwriting SQL/review pair outside workspace', async () => {
    const options = await artifacts();
    const result = await prepareRefresh(options);
    expect(digest(await readFile(result.sqlPath, 'utf8'))).toBe(result.sqlSha256);
    const review = JSON.parse(await readFile(result.reviewPath, 'utf8'));
    expect(review.inputDigests.sourceManifestSha256).toBe(options.sourceManifestSha256);
    expect(review.offlinePreparationOnly).toBe(true);
    await expect(prepareRefresh(options)).rejects.toThrow(/artifact-io-or-format/);
  });
  it.each([
    'archiveSha256',
    'sourceManifestSha256',
    'targetManifestSha256',
    'schemaSha256',
  ] as const)('fails closed on incorrect %s', async (field) => {
    const options = await artifacts();
    options[field] = 'b'.repeat(64);
    await expect(prepareRefresh(options)).rejects.toThrow(/artifact-hash-mismatch/);
  });
  it('rejects output in workspace and redacts filesystem/format failures', async () => {
    const options = await artifacts();
    await expect(prepareRefresh({ ...options, outputDirectory: process.cwd() })).rejects.toThrow(
      /private-output-required/,
    );
    await expect(
      prepareRefresh({
        ...options,
        archivePath: path.join(options.outputDirectory, 'sensitive-missing-file'),
      }),
    ).rejects.toThrow(/^Refresh preparation stopped \(artifact-io-or-format\)/);
  });
  it('rejects a non-custom-format archive even with a correct digest', async () => {
    const options = await artifacts();
    await writeFile(options.archivePath, 'not a postgres archive');
    options.archiveSha256 = digest('not a postgres archive');
    await expect(prepareRefresh(options)).rejects.toThrow(/archive-format/);
  });
});

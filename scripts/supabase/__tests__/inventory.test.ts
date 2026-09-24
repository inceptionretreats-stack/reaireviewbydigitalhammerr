import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  INVENTORY_SESSION_SQL,
  InventoryError,
  compareInventories,
  inventory,
} from '../inventory.mjs';

type Table = {
  schema: string;
  name: string;
  kind: string;
  persistence: string;
  isPartition: boolean;
  rowSecurity: boolean;
  forceRowSecurity: boolean;
  replicaIdentity: string;
  partitionKey: string | null;
  partitionBound: string | null;
  parents: { schema: string; name: string; position: number }[];
};

const SESSION = {
  serverVersion: '180006',
  isolation: 'repeatable read',
  readOnly: 'on',
  TimeZone: 'UTC',
  DateStyle: 'ISO, YMD',
  IntervalStyle: 'postgres',
  extra_float_digits: '3',
  bytea_output: 'hex',
  search_path: 'pg_catalog',
  row_security: 'off',
};

function table(schema: string, name: string, overrides: Partial<Table> = {}): Table {
  return {
    schema,
    name,
    kind: 'r',
    persistence: 'p',
    isPartition: false,
    rowSecurity: false,
    forceRowSecurity: false,
    replicaIdentity: 'd',
    partitionKey: null,
    partitionBound: null,
    parents: [],
    ...overrides,
  };
}

function column(t: Table, name = 'id', position = 1) {
  return {
    schema: t.schema,
    table: t.name,
    position,
    name,
    type: 'integer',
    notNull: true,
    identity: '',
    generated: '',
    defaultExpression: null,
    collation: null,
  };
}

const identifier = (value: string) => `"${value.replaceAll('"', '""')}"`;
const qualified = (t: { schema: string; name: string }) =>
  `${identifier(t.schema)}.${identifier(t.name)}`;
const rowHash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

function fixture() {
  const migration = table('drizzle', '__drizzle_migrations');
  const parent = table('public', 'analytics_events', {
    kind: 'p',
    partitionKey: 'RANGE (occurred_at)',
  });
  const child = table('public', 'analytics_events_2026_09', {
    isPartition: true,
    partitionBound: "FOR VALUES FROM ('2026-09-01 00:00:00+00') TO ('2026-10-01 00:00:00+00')",
    parents: [{ schema: 'public', name: 'analytics_events', position: 1 }],
  });
  const users = table('public', 'users');
  const tables = [migration, parent, child, users];
  const migrationRows = [{ id: '1', hash: 'a'.repeat(64), createdAt: '1790000000000' }];
  const userRows = [
    { id: 1, email: 'PRIVATE_CUSTOMER@example.test', credential: 'DO_NOT_PRINT_ME' },
  ];
  const analyticsRows = [
    { id: 1, businessId: 'private-business' },
    { id: 2, businessId: 'another' },
  ];
  return {
    session: { ...SESSION },
    schemas: [{ name: 'drizzle' }, { name: 'public' }],
    tables,
    columns: tables.map((t) => column(t)),
    constraints: [
      {
        schema: 'public',
        table: 'users',
        name: 'users_pk',
        type: 'p',
        definition: 'PRIMARY KEY (id)',
      },
    ],
    indexes: [
      {
        schema: 'public',
        table: 'users',
        name: 'users_pk',
        definition: 'CREATE UNIQUE INDEX users_pk ON public.users USING btree (id)',
      },
    ],
    sequences: [
      {
        schema: 'public',
        name: 'analytics_events_id_seq',
        type: 'bigint',
        start: '1',
        increment: '1',
        minimum: '1',
        maximum: '9223372036854775807',
        cache: '1',
        cycle: false,
        ownedBy: [{ schema: 'public', table: 'analytics_events', column: 'id', dependency: 'i' }],
      },
    ],
    sequenceState: { lastValue: '9007199254740993', isCalled: true },
    enums: [{ schema: 'public', name: 'status', labels: ['ACTIVE', 'INACTIVE'] }],
    migrations: migrationRows,
    data: new Map([
      [qualified(migration), migrationRows.map(rowHash)],
      [qualified(parent), analyticsRows.map(rowHash)],
      [qualified(child), analyticsRows.map(rowHash)],
      [qualified(users), userRows.map(rowHash)],
    ]),
  };
}

function clientFor(data = fixture()) {
  let remaining: { row_hash: string }[] = [];
  let streamOverride: string[] | undefined;
  const client = {
    query: vi.fn(async (sql: string, _params: unknown[] = []) => {
      if (sql.includes('inventory:session')) return { rows: [{ ...data.session }] };
      for (const key of [
        'schemas',
        'tables',
        'columns',
        'constraints',
        'indexes',
        'sequences',
        'enums',
        'migrations',
      ] as const) {
        if (sql.includes(`inventory:${key} */`)) return { rows: structuredClone(data[key]) };
      }
      if (sql.includes('inventory:sequence-state')) return { rows: [{ ...data.sequenceState }] };
      if (sql.includes('inventory:row-hashes')) {
        // Mocks model database-side sorting, not a client-side reordering of returned hashes.
        const relation = [...data.data.keys()].find((key) => sql.includes(`${key} AS record`));
        if (!relation) throw new Error('Unknown relation in mock');
        remaining = (streamOverride ?? [...data.data.get(relation)!].sort()).map((row_hash) => ({
          row_hash,
        }));
        return { rows: [] };
      }
      if (sql.startsWith('FETCH')) {
        const size = Number(sql.match(/FETCH FORWARD (\d+)/)?.[1]);
        return { rows: remaining.splice(0, size) };
      }
      if (sql.startsWith('CLOSE')) return { rows: [] };
      throw new Error('Unexpected statement in mock');
    }),
    end: vi.fn(),
    release: vi.fn(),
    setHashStream: (hashes: string[]) => {
      streamOverride = hashes;
    },
  };
  return client;
}

describe('read-only Supabase migration inventory', () => {
  it('is importable without database configuration and provides only local session normalization', () => {
    expect(INVENTORY_SESSION_SQL).toContain("SET LOCAL TimeZone = 'UTC'");
    expect(INVENTORY_SESSION_SQL).toContain("SET LOCAL row_security = 'off'");
    expect(INVENTORY_SESSION_SQL).toContain("SET LOCAL search_path = 'pg_catalog'");
    expect(INVENTORY_SESSION_SQL).not.toMatch(
      /\b(BEGIN|COMMIT|ROLLBACK|CREATE|ALTER|DROP|INSERT|UPDATE|DELETE)\b/,
    );
  });

  it('captures data, structure, sequence ownership/state, migration hashes and physical partitions', async () => {
    const result = await inventory(clientFor(), { batchSize: 1 });
    expect(result.physicalRowCount).toBe('4'); // 1 migration + 2 physical events + 1 user, not 6.
    expect(result.tables).toHaveLength(4);
    const parent = result.tables.find((t: Table) => t.name === 'analytics_events');
    const child = result.tables.find((t: Table) => t.name === 'analytics_events_2026_09');
    expect(parent).toMatchObject({
      kind: 'p',
      partitionKey: 'RANGE (occurred_at)',
      rows: { count: '2', scope: 'including-descendants' },
    });
    expect(child).toMatchObject({
      isPartition: true,
      rows: { count: '2', scope: 'only' },
      parents: [{ schema: 'public', name: 'analytics_events', position: 1 }],
    });
    expect(child.partitionBound).toContain('2026-10-01');
    expect(result.sequences[0].state).toEqual({ lastValue: '9007199254740993', isCalled: true });
    expect(result.sequences[0].ownedBy[0].column).toBe('id');
    expect(result.enums[0].labels).toEqual(['ACTIVE', 'INACTIVE']);
    expect(result.migrations).toEqual({ present: true, entries: fixture().migrations });
  });

  it('uses read-only cursors, C ordering and ONLY for physical tables without owning the transaction', async () => {
    const client = clientFor();
    await inventory(client, { batchSize: 1 });
    const statements = client.query.mock.calls.map(([sql]) => sql);
    const cursors = statements.filter((sql) => sql.includes('inventory:row-hashes'));
    expect(cursors).toHaveLength(4);
    for (const sql of cursors) {
      expect(sql).toContain('NO SCROLL CURSOR WITHOUT HOLD');
      expect(sql).toContain('sha256(convert_to(to_jsonb(record)::text');
      expect(sql).toContain('ORDER BY row_hash COLLATE "C"');
      expect(sql).not.toMatch(/\b(?:ctid|tableoid|OFFSET)\b/);
    }
    expect(
      cursors.find((sql) => sql.includes('"public"."analytics_events" AS record')),
    ).not.toContain('FROM ONLY');
    expect(
      cursors.find((sql) => sql.includes('"public"."analytics_events_2026_09" AS record')),
    ).toContain('FROM ONLY');
    expect(statements.filter((sql) => sql.startsWith('CLOSE'))).toHaveLength(4);
    expect(
      statements.every((sql) =>
        /^\s*(?:\/\*[^]*?\*\/\s*)?(SELECT|DECLARE|FETCH|CLOSE)\b/.test(sql),
      ),
    ).toBe(true);
    expect(client.end).not.toHaveBeenCalled();
    expect(client.release).not.toHaveBeenCalled();
    for (const [sql, params] of client.query.mock.calls) {
      if (/inventory:(tables|columns|constraints|indexes|sequences|enums) \*\//.test(sql)) {
        expect(params).toEqual([['drizzle', 'public']]);
      }
    }
  });

  it('produces identical digests regardless of physical row order or cursor batch boundaries', async () => {
    const first = fixture();
    const second = fixture();
    for (const [key, values] of second.data) second.data.set(key, values.reverse());
    const a = await inventory(clientFor(first), { batchSize: 1 });
    const b = await inventory(clientFor(second), { batchSize: 100 });
    expect(a).toEqual(b);
    expect(compareInventories(a, b).matches).toBe(true);
  });

  it('preserves duplicate rows and detects one modified row even when the count is unchanged', async () => {
    const baseline = await inventory(clientFor());
    const changed = fixture();
    changed.data.set('"public"."users"', [rowHash({ changed: true })]);
    const modified = await inventory(clientFor(changed));
    expect(modified.physicalRowCount).toBe(baseline.physicalRowCount);
    expect(compareInventories(baseline, modified)).toMatchObject({
      matches: false,
      dataMatches: false,
      structureMatches: true,
    });
    changed.data.set('"public"."users"', [rowHash({ id: 1 }), rowHash({ id: 1 })]);
    const duplicate = await inventory(clientFor(changed), { batchSize: 1 });
    expect(duplicate.tables.find((t: Table) => t.name === 'users').rows.count).toBe('2');
  });

  it('binds digests to column names and positions and inventories defaults/types separately', async () => {
    const a = await inventory(clientFor());
    const changed = fixture();
    changed.columns.find((c) => c.table === 'users')!.position = 2;
    const b = await inventory(clientFor(changed));
    expect(compareInventories(a, b)).toMatchObject({ dataMatches: false, structureMatches: false });
  });

  it('makes deterministic non-null digests for empty physical partitions', async () => {
    const data = fixture();
    data.data.set('"public"."analytics_events_2026_09"', []);
    const result = await inventory(clientFor(data));
    expect(
      result.tables.find((t: Table) => t.name === 'analytics_events_2026_09').rows,
    ).toMatchObject({ count: '0', sha256: expect.stringMatching(/^[a-f0-9]{64}$/), scope: 'only' });
  });

  it.each([
    { readOnly: 'off' },
    { isolation: 'read committed' },
    { isolation: 'read uncommitted' },
  ])('fails closed outside a read-only consistent transaction: %j', async (patch) => {
    const data = fixture();
    Object.assign(data.session, patch);
    const client = clientFor(data);
    await expect(inventory(client)).rejects.toMatchObject({ code: 'READ_ONLY_SNAPSHOT_REQUIRED' });
    expect(client.query).toHaveBeenCalledTimes(1);
  });

  it.each([
    'TimeZone',
    'DateStyle',
    'IntervalStyle',
    'extra_float_digits',
    'bytea_output',
    'search_path',
    'row_security',
  ] as const)('rejects noncanonical %s rather than producing misleading hashes', async (key) => {
    const data = fixture();
    data.session[key] = 'noncanonical';
    await expect(inventory(clientFor(data))).rejects.toMatchObject({
      code: 'CANONICAL_SESSION_REQUIRED',
    });
  });

  it('accepts caller-owned serializable snapshots', async () => {
    const data = fixture();
    data.session.isolation = 'serializable';
    await expect(inventory(clientFor(data))).resolves.toMatchObject({ formatVersion: 1 });
  });

  it.each([0, -1, 1.5, 10001, NaN])(
    'rejects unsafe batch size %s before issuing SQL',
    async (batchSize) => {
      const client = clientFor();
      await expect(inventory(client, { batchSize })).rejects.toMatchObject({
        code: 'INVALID_BATCH_SIZE',
      });
      expect(client.query).not.toHaveBeenCalled();
    },
  );

  it('rejects unsupported versions and foreign tables', async () => {
    const old = fixture();
    old.session.serverVersion = '160000';
    await expect(inventory(clientFor(old))).rejects.toMatchObject({
      code: 'POSTGRES_17_OR_LATER_REQUIRED',
    });
    const foreign = fixture();
    foreign.tables[0].kind = 'f';
    await expect(inventory(clientFor(foreign))).rejects.toMatchObject({
      code: 'FOREIGN_TABLE_UNSUPPORTED',
    });
  });

  it('quotes catalog identifiers instead of interpolating unsafe names', async () => {
    const data = fixture();
    const unusual = table('public', 'strange"; DROP TABLE users; --');
    data.tables.push(unusual);
    data.columns.push(column(unusual));
    data.data.set(qualified(unusual), []);
    const client = clientFor(data);
    await inventory(client);
    expect(
      client.query.mock.calls.find(([sql]) =>
        sql.includes('"strange""; DROP TABLE users; --" AS record'),
      ),
    ).toBeDefined();
  });

  it.each([{ stream: ['PRIVATE_PLAINTEXT'] }, { stream: ['f'.repeat(64), 'a'.repeat(64)] }])(
    'rejects non-hash or unsorted streams, closing its cursor',
    async ({ stream }) => {
      const client = clientFor();
      client.setHashStream(stream);
      await expect(inventory(client)).rejects.toMatchObject({ code: 'INVALID_ROW_HASH_STREAM' });
      expect(client.query.mock.calls.at(-1)?.[0]).toMatch(/^CLOSE /);
    },
  );

  it('does not return customer records, per-row hashes, or print anything', async () => {
    const consoleSpies = ['log', 'warn', 'error'].map((method) =>
      vi.spyOn(console, method as 'log').mockImplementation(() => {}),
    );
    try {
      const data = fixture();
      const result = await inventory(clientFor(data));
      const serialized = JSON.stringify(result);
      expect(serialized).not.toMatch(/PRIVATE_CUSTOMER|DO_NOT_PRINT_ME|private-business/);
      for (const value of data.data.get('"public"."users"')!)
        expect(serialized).not.toContain(value);
      for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of consoleSpies) spy.mockRestore();
    }
  });

  it('redacts database errors without attaching raw errors or taking transaction ownership', async () => {
    const client = clientFor();
    client.query.mockRejectedValueOnce(
      Object.assign(new Error('postgres://user:PASSWORD@private.host PRIVATE_CUSTOMER'), {
        detail: 'credential record',
      }),
    );
    try {
      await inventory(client);
      expect.fail('Expected safe inventory error');
    } catch (error) {
      expect(error).toBeInstanceOf(InventoryError);
      expect(error).toMatchObject({ code: 'QUERY_FAILED' });
      expect(String(error)).not.toMatch(/PASSWORD|private.host|PRIVATE_CUSTOMER|credential record/);
      expect(error).not.toHaveProperty('cause');
    }
    expect(client.end).not.toHaveBeenCalled();
    expect(client.release).not.toHaveBeenCalled();
  });
});

describe('pure migration manifest comparison', () => {
  it('reports PG18 named NOT NULL differences separately and still fails overall verification', async () => {
    const sourceData = fixture();
    sourceData.constraints.push({
      schema: 'public',
      table: 'users',
      name: 'users_id_not_null',
      type: 'n',
      definition: 'NOT NULL id',
    });
    const targetData = fixture();
    targetData.session.serverVersion = '170006';
    const source = await inventory(clientFor(sourceData));
    const target = await inventory(clientFor(targetData));
    const report = compareInventories(source, target);
    expect(report).toMatchObject({
      matches: false,
      dataMatches: true,
      structureMatches: true,
      namedNotNullConstraintsMatch: false,
      serverVersionsDiffer: true,
    });
    expect(report.differences).toEqual([
      {
        category: 'named-not-null',
        object: '["public","users"]',
        sourceSha256: expect.any(String),
        targetSha256: expect.any(String),
      },
    ]);
  });

  it('reports intended hardening as an explicit security difference, not an automatic pass', async () => {
    const source = await inventory(clientFor());
    const target = structuredClone(source);
    target.tables.find((t: Table) => t.name === 'users').rowSecurity = true;
    expect(compareInventories(source, target)).toMatchObject({
      matches: false,
      dataMatches: true,
      structureMatches: true,
      securityMatches: false,
    });
  });

  it.each(['partitionBound', 'partitionKey', 'columns', 'constraints', 'indexes'])(
    'detects structure changes in %s',
    async (field) => {
      const source = await inventory(clientFor());
      const target = structuredClone(source);
      target.tables[0][field] = 'changed';
      expect(compareInventories(source, target)).toMatchObject({
        matches: false,
        structureMatches: false,
      });
    },
  );

  it('detects missing zero-row tables even when physical totals remain equal', async () => {
    const source = await inventory(clientFor());
    const target = structuredClone(source);
    target.tables.pop();
    expect(compareInventories(source, target)).toMatchObject({
      matches: false,
      structureMatches: false,
      dataMatches: false,
    });
  });

  it('compares exact sequence position and is_called separately from definition', async () => {
    const source = await inventory(clientFor());
    const target = structuredClone(source);
    target.sequences[0].state.isCalled = false;
    expect(compareInventories(source, target)).toMatchObject({
      matches: false,
      structureMatches: true,
      sequenceStateMatches: false,
    });
    target.sequences = [];
    expect(compareInventories(source, target)).toMatchObject({
      matches: false,
      structureMatches: false,
      sequenceStateMatches: false,
    });
  });

  it('detects migration hash changes and missing drizzle history', async () => {
    const source = await inventory(clientFor());
    const target = structuredClone(source);
    target.migrations.entries[0].hash = 'b'.repeat(64);
    expect(compareInventories(source, target).migrationHistoryMatches).toBe(false);
    const missing = fixture();
    missing.tables = missing.tables.filter((t) => t.schema !== 'drizzle');
    const result = await inventory(clientFor(missing));
    expect(result.migrations).toEqual({ present: false, entries: [] });
    expect(compareInventories(source, result).migrationHistoryMatches).toBe(false);
  });

  it('returns difference hashes, never raw changed defaults or values', async () => {
    const source = await inventory(clientFor());
    const target = structuredClone(source);
    target.tables[0].columns[0].defaultExpression = "'DO_NOT_LOG_THIS'::text";
    const report = compareInventories(source, target);
    expect(JSON.stringify(report)).not.toContain('DO_NOT_LOG_THIS');
    expect(report.differences[0].sourceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(report.differences[0].targetSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects incompatible manifest versions or algorithms', async () => {
    const source = await inventory(clientFor());
    expect(() => compareInventories(source, { ...source, formatVersion: 2 })).toThrow(
      InventoryError,
    );
    expect(() => compareInventories(source, { ...source, algorithm: 'md5' })).toThrow(
      InventoryError,
    );
  });
});

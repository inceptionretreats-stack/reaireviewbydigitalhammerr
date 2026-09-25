import { readFileSync } from 'node:fs';
import { getTableName, isTable } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import * as schema from '@ai-review/db/schema';

// Import schema definitions only: this test must not connect to a database.
const hardeningSql = readFileSync(new URL('../lock-down.sql', import.meta.url), 'utf8');
const declaration = hardeningSql.match(/app_tables\s+text\[\]\s*:=\s*ARRAY\[([^\]]*)\]/i);
const protectedTables = [...(declaration?.[1] ?? '').matchAll(/'([a-z][a-z0-9_]*)'/g)].map(
  (match) => match[1],
);
const schemaTables = Object.values(schema).filter(isTable).map(getTableName).sort();

describe('Supabase server-only table hardening', () => {
  it('declares a nonempty explicit allowlist without duplicate table names', () => {
    expect(declaration).not.toBeNull();
    expect(protectedTables.length).toBeGreaterThan(0);
    expect(new Set(protectedTables).size).toBe(protectedTables.length);
  });

  it('covers every current Drizzle app table and no unrelated tables', () => {
    expect(schemaTables.length).toBeGreaterThan(0);
    expect([...protectedTables].sort()).toEqual(schemaTables);
  });

  it('also protects the private migration journal and its sequence', () => {
    expect(hardeningSql).toContain(
      'ALTER TABLE drizzle.__drizzle_migrations ENABLE ROW LEVEL SECURITY',
    );
    expect(hardeningSql).toContain(
      'REVOKE ALL ON SCHEMA drizzle FROM PUBLIC, anon, authenticated, service_role',
    );
    expect(hardeningSql).toContain(
      'REVOKE ALL ON TABLE drizzle.__drizzle_migrations FROM PUBLIC, anon, authenticated, service_role',
    );
    expect(hardeningSql).toContain(
      'REVOKE ALL ON SEQUENCE drizzle.__drizzle_migrations_id_seq FROM PUBLIC, anon, authenticated, service_role',
    );
  });
});

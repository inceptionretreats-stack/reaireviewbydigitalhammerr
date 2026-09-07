#!/usr/bin/env node
/**
 * Guards the hand-written DDL that Drizzle cannot model.
 *
 * analytics_events is PARTITION BY RANGE, declared by hand in 0000 because drizzle-kit has no
 * DSL for partitioning. The consequence is that meta/0000_snapshot.json describes an ORDINARY
 * table — so the next `drizzle-kit generate` diffs against the wrong shape and can emit a
 * migration that drops or recreates it, taking every retained analytics row with it.
 *
 * Regenerating the snapshot cannot fix this (the DSL still cannot express PARTITION), so the
 * drift is instead made loud: any migration touching analytics_events destructively fails CI,
 * and the drift itself is reported so nobody "repairs" the snapshot and quietly removes the
 * only thing standing between a routine schema change and total analytics loss.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DRIZZLE_DIR = 'packages/db/drizzle';
const GUARDED_TABLE = 'analytics_events';

const DESTRUCTIVE = [
  {
    pattern: /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?"?analytics_events"?/i,
    label: 'DROP TABLE analytics_events',
  },
  {
    pattern: /ALTER\s+TABLE\s+(?:public\.)?"?analytics_events"?\s+DROP\s+COLUMN/i,
    label: 'DROP COLUMN on analytics_events',
  },
  {
    pattern: /TRUNCATE\s+(?:TABLE\s+)?(?:public\.)?"?analytics_events"?/i,
    label: 'TRUNCATE analytics_events',
  },
];

/**
 * Comments are stripped before scanning. The DDL in 0000 documents its own retention strategy
 * in prose containing the phrase "DROP TABLE on one partition" — matching that produced a false
 * positive on the very migration this guard exists to protect.
 */
function stripSqlComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

const TOUCHES_GUARDED = /(ALTER|CREATE|DROP)\s+(TABLE|INDEX)[^;]{0,160}?"?analytics_events"?/i;

let failures = 0;
const fail = (msg) => {
  console.error(`  FAIL  ${msg}`);
  failures += 1;
};

const files = readdirSync(DRIZZLE_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort();

if (files.length === 0) fail(`no migrations found in ${DRIZZLE_DIR}`);

console.log(`Checking ${files.length} migration(s)...`);

for (const file of files) {
  const raw = readFileSync(join(DRIZZLE_DIR, file), 'utf8');
  const sql = stripSqlComments(raw);

  // Any statement at all against the guarded table in a LATER migration is suspect, not just a
  // destructive one. Observed in practice: generating a migration for an unrelated foreign key
  // also emitted "ALTER TABLE analytics_events ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY",
  // because the snapshot does not know the column is already an identity. That statement is not
  // destructive, and it fails outright.
  if (!file.startsWith('0000')) {
    if (TOUCHES_GUARDED.test(sql)) {
      fail(
        `${file} contains a statement touching ${GUARDED_TABLE}. The snapshot models it as an ` +
          `ordinary unpartitioned table, so drizzle-kit's diff against it is unreliable. Review ` +
          `the statement by hand, and delete it if it is re-asserting hand-written DDL from 0000.`,
      );
    }
  }

  for (const { pattern, label } of DESTRUCTIVE) {
    if (pattern.test(sql)) {
      fail(
        `${file} contains "${label}". ${GUARDED_TABLE} is partitioned and holds 13 months of ` +
          `retained events. If this is deliberate, write the migration by hand with an explicit ` +
          `data-preservation step and update this guard in the same commit.`,
      );
    }
  }

  if (file.startsWith('0000') && !/PARTITION\s+BY\s+RANGE/i.test(raw)) {
    fail(
      `${file} no longer declares PARTITION BY RANGE on ${GUARDED_TABLE}. This is exactly what a ` +
        `naive \`drizzle-kit generate\` overwrite looks like — restore the hand-written DDL.`,
    );
  }
}

const snapshotPath = join(DRIZZLE_DIR, 'meta', '0000_snapshot.json');
try {
  const snapshot = readFileSync(snapshotPath, 'utf8');
  if (/PARTITION/i.test(snapshot)) {
    console.log(
      '  NOTE  snapshot now mentions PARTITION — drizzle-kit may have gained support; re-evaluate this guard.',
    );
  } else {
    console.log(`  OK    known drift present: snapshot models ${GUARDED_TABLE} as unpartitioned.`);
    console.log('        Any generated migration touching it must be reviewed by hand.');
  }
} catch {
  fail(`could not read ${snapshotPath}`);
}

if (failures > 0) {
  console.error(`\n${failures} migration guard failure(s).`);
  process.exit(1);
}

console.log('Migration guard passed.');

/**
 * Points the ACTIVE prompt version at a different model.
 *
 *   node scripts/ops/set-ai-model.mjs claude-haiku-4-5
 *   node scripts/ops/set-ai-model.mjs claude-haiku-4-5 --effort ''
 *   node scripts/ops/set-ai-model.mjs --show
 *
 * ADR-006 puts the model in `ai_prompt_versions` precisely so quality can be rolled back without
 * a deploy. Until now the only writer was the seed script, which reads a file in `docs/spec/` —
 * a frozen contract — so the promised rollback was not actually available to anyone. This is the
 * smallest honest version of it, and the seam an admin screen (ADMIN-03) will later sit on.
 *
 * It deliberately does NOT create a new prompt version. Changing the model of the running one is
 * the operation you want mid-incident; introducing a version is a content change that belongs
 * with the prompt text, and `uq_one_active_prompt_version` means getting that wrong leaves the
 * new row DRAFT and silently unused.
 */
import pg from 'pg';

try {
  process.loadEnvFile('.env');
} catch {
  // No .env — the real environment is expected to carry DATABASE_URL.
}

const args = process.argv.slice(2);
const show = args.includes('--show');
const effortIndex = args.indexOf('--effort');
const effort = effortIndex >= 0 ? (args[effortIndex + 1] ?? '') : null;
const model = args.find((a) => !a.startsWith('--') && a !== effort);

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is required. Start the database with `pnpm db:dev`.');
  process.exit(1);
}

if (!show && !model) {
  console.error('Usage: node scripts/ops/set-ai-model.mjs <model-id> [--effort <value>] | --show');
  process.exit(1);
}

const client = new pg.Client({ connectionString });
await client.connect();

try {
  const { rows: current } = await client.query(
    `SELECT id, version, model, reasoning_effort, max_output_tokens
       FROM ai_prompt_versions WHERE status = 'ACTIVE' LIMIT 1`,
  );

  const active = current[0];
  if (!active) {
    console.error('No ACTIVE prompt version. Run `pnpm seed` first.');
    process.exit(1);
  }

  if (show) {
    console.log('Active prompt version');
    console.log(`  version           ${active.version}`);
    console.log(`  model             ${active.model}`);
    console.log(`  reasoning_effort  ${JSON.stringify(active.reasoning_effort)}`);
    console.log(`  max_output_tokens ${active.max_output_tokens}`);
    process.exit(0);
  }

  const { rows: updated } = await client.query(
    // No timestamp touched: this table has created_at and activated_at, and neither describes
    // "the model changed". Inventing an updated_at here would mean a schema change for a script.
    `UPDATE ai_prompt_versions
        SET model = $1,
            reasoning_effort = COALESCE($2, reasoning_effort)
      WHERE id = $3
      RETURNING model, reasoning_effort`,
    [model, effort, active.id],
  );

  const row = updated[0];
  console.log(`Prompt version ${active.version} now uses:`);
  console.log(`  model             ${active.model}  ->  ${row.model}`);
  console.log(
    `  reasoning_effort  ${JSON.stringify(active.reasoning_effort)}  ->  ${JSON.stringify(row.reasoning_effort)}`,
  );
  console.log('\nNo restart needed: the model is read per request.');
} finally {
  await client.end();
}

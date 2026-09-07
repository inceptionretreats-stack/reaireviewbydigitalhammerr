import { Pool } from 'pg';

/**
 * Direct database access for E2E fixtures.
 *
 * Used only to arrange state the UI has no route to — chiefly the free-generation counter, which
 * a business owner cannot reset and an admin tool for it does not exist yet. Assertions still go
 * through the browser; this only sets the stage.
 *
 * The first run of this suite exhausted the demo tenant's ten free generations and every later
 * generation test failed. That was the quota working exactly as AC-013 specifies — the tests were
 * what needed fixing.
 */

const CONNECTION =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/ai_review';

let pool: Pool | undefined;

function db(): Pool {
  pool ??= new Pool({ connectionString: CONNECTION, max: 4 });
  return pool;
}

export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = undefined;
}

export async function demoBusinessId(): Promise<string> {
  const { rows } = await db().query<{ id: string }>(
    `SELECT id FROM businesses WHERE name = 'Demo South Cafe' LIMIT 1`,
  );
  const id = rows[0]?.id;
  if (!id) throw new Error('Demo tenant not found. Run the seed before the E2E suite.');
  return id;
}

/** Returns the tenant to a full free allowance so a generation test has room to run. */
export async function resetFreeQuota(): Promise<void> {
  await db().query(
    `UPDATE subscriptions SET free_generations_used = 0, status = 'FREE'
     WHERE business_id = (SELECT id FROM businesses WHERE name = 'Demo South Cafe')`,
  );
}

/** Drives the tenant to its limit, so the exhausted path can be exercised (Flow E step 3). */
export async function exhaustFreeQuota(): Promise<void> {
  await db().query(
    `UPDATE subscriptions SET free_generations_used = free_generation_limit, status = 'FREE'
     WHERE business_id = (SELECT id FROM businesses WHERE name = 'Demo South Cafe')`,
  );
}

export async function quotaUsed(): Promise<number> {
  const { rows } = await db().query<{ used: number }>(
    `SELECT s.free_generations_used AS used FROM subscriptions s
     JOIN businesses b ON b.id = s.business_id WHERE b.name = 'Demo South Cafe'`,
  );
  return rows[0]?.used ?? 0;
}

/** The seeded QR code, so specs do not hard-code a value the seed regenerates. */
export async function demoQrCode(): Promise<string> {
  const { rows } = await db().query<{ code: string }>(
    `SELECT q.code FROM qr_codes q JOIN businesses b ON b.id = q.business_id
     WHERE b.name = 'Demo South Cafe' AND q.status = 'ACTIVE' ORDER BY q.created_at LIMIT 1`,
  );
  const code = rows[0]?.code;
  if (!code) throw new Error('No active QR code for the demo tenant. Run the seed.');
  return code;
}

import { createHash } from 'node:crypto';
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

/**
 * Returns the tenant to a full free allowance so a generation test has room to run.
 *
 * The stored drafts go too. The similarity gate compares a new draft against what is persisted
 * for the anonymous session, so leaving them behind means a suite that reuses a browser context
 * eventually proposes something too close to a draft from an earlier run and fails on a quality
 * rejection that has nothing to do with the test. It passes today only because every Playwright
 * test gets a fresh context and therefore a fresh anonymous cookie — an accident, not a design.
 */
/**
 * Puts the demo tenant back on the Free plan with its counters at zero — the state every other
 * suite assumes — after the admin suite has put it on Pro. The audit rows written along the way
 * are left alone: they are the record, and nothing in the product deletes them.
 */
export async function resetDemoEntitlement(): Promise<void> {
  await db().query(
    `UPDATE subscriptions
        SET status = 'FREE', starts_at = NULL, expires_at = NULL, pro_generations_used = 0,
            free_generations_used = 0, entitlement_source = 'NONE', entitlement_note = NULL,
            entitlement_granted_by = NULL
      WHERE business_id = (SELECT id FROM businesses WHERE name = 'Demo South Cafe')`,
  );
  await db().query(
    `DELETE FROM ai_generations
     WHERE business_id = (SELECT id FROM businesses WHERE name = 'Demo South Cafe')`,
  );
}

export async function resetFreeQuota(): Promise<void> {
  await db().query(
    `UPDATE subscriptions SET free_generations_used = 0, status = 'FREE'
     WHERE business_id = (SELECT id FROM businesses WHERE name = 'Demo South Cafe')`,
  );
  await db().query(
    `DELETE FROM ai_generations
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

export interface DemoReviewDestinationSnapshot {
  id: string;
  businessId: string;
  url: string;
  isEnabled: boolean;
  destinationUpdatedAt: Date;
  configVersion: string;
  businessUpdatedAt: Date;
}

/**
 * Captures the mutable destination so a test can prove an owner edit and still return the shared
 * demo tenant to byte-for-byte business state. The fixture uses an intentionally non-live URL that
 * the production validator will not accept, so cleanup cannot honestly go through the public PUT.
 */
export async function demoReviewDestinationSnapshot(): Promise<DemoReviewDestinationSnapshot> {
  const { rows } = await db().query<DemoReviewDestinationSnapshot>(
    `SELECT rd.id,
            rd.business_id AS "businessId",
            rd.url,
            rd.is_enabled AS "isEnabled",
            rd.updated_at AS "destinationUpdatedAt",
            b.config_version::text AS "configVersion",
            b.updated_at AS "businessUpdatedAt"
       FROM review_destinations rd
       JOIN businesses b ON b.id = rd.business_id
      WHERE b.name = 'Demo South Cafe' AND rd.is_primary = true
      LIMIT 1`,
  );
  const snapshot = rows[0];
  if (!snapshot) throw new Error('Demo review destination not found. Run the seed before E2E.');
  return snapshot;
}

/** Cleanup for `demoReviewDestinationSnapshot`, kept transactional so the cache marker agrees. */
export async function restoreDemoReviewDestination(
  snapshot: DemoReviewDestinationSnapshot,
): Promise<void> {
  const client = await db().connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE review_destinations
          SET url = $1, is_enabled = $2, updated_at = $3
        WHERE id = $4 AND business_id = $5`,
      [
        snapshot.url,
        snapshot.isEnabled,
        snapshot.destinationUpdatedAt,
        snapshot.id,
        snapshot.businessId,
      ],
    );
    await client.query(`UPDATE businesses SET config_version = $1, updated_at = $2 WHERE id = $3`, [
      snapshot.configVersion,
      snapshot.businessUpdatedAt,
      snapshot.businessId,
    ]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Simulates a destination disabled by an older admin/import path. */
export async function setDemoReviewDestinationEnabled(enabled: boolean): Promise<void> {
  const client = await db().connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE review_destinations
          SET is_enabled = $1, updated_at = now()
        WHERE business_id = (SELECT id FROM businesses WHERE name = 'Demo South Cafe')
          AND is_primary = true`,
      [enabled],
    );
    await client.query(
      `UPDATE businesses
          SET config_version = (extract(epoch from clock_timestamp()) * 1000)::bigint,
              updated_at = now()
        WHERE name = 'Demo South Cafe'`,
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Counts an event produced by one exact anonymous browser session and QR source. */
export async function eventCountForQrSession(
  eventName: string,
  qrCode: string,
  anonymousToken: string,
): Promise<number> {
  const businessId = await demoBusinessId();
  const publicTokenHash = createHash('sha256')
    .update(`${anonymousToken}:${businessId}`)
    .digest('hex');

  const { rows } = await db().query<{ total: number }>(
    `SELECT COUNT(*)::int AS total
     FROM analytics_events event
     JOIN qr_codes qr ON qr.id = event.qr_code_id
     JOIN anonymous_sessions session ON session.id = event.anonymous_session_id
     WHERE event.event_name = $1
       AND qr.code = $2
       AND session.business_id = $3
       AND session.public_token_hash = $4`,
    [eventName, qrCode, businessId, publicTokenHash],
  );
  return rows[0]?.total ?? 0;
}

/**
 * Arranges a paid state the UI cannot reach without Razorpay keys: a Pro year that ends in
 * `daysLeft` days, plus one captured payment for it so the history and receipt have a row.
 * Returns the payment id. `removeDemoPayments` takes the rows away again.
 */
export async function arrangeDemoPaidYear(daysLeft: number): Promise<string> {
  const businessId = await demoBusinessId();
  const expiresAt = new Date(Date.now() + daysLeft * 86_400_000);
  const startsAt = new Date(expiresAt.getTime() - 365 * 86_400_000);
  await db().query(
    `UPDATE subscriptions
        SET status = 'PRO_ACTIVE', starts_at = $2, expires_at = $3, pro_generations_used = 0,
            entitlement_source = 'PAYMENT', entitlement_note = 'e2e', entitlement_granted_by = NULL
      WHERE business_id = $1`,
    [businessId, startsAt, expiresAt],
  );
  const { rows } = await db().query<{ id: string }>(
    `INSERT INTO payments (business_id, provider, provider_order_id, provider_payment_id,
                           amount_paise, currency, status, paid_at, raw_reference)
     VALUES ($1, 'RAZORPAY', 'order_E2EFixture0001', 'pay_E2EFixture0001', 99900, 'INR',
             'CAPTURED', $2, $3)
     RETURNING id`,
    [
      businessId,
      startsAt,
      JSON.stringify({
        source: 'e2e',
        period_starts_at: startsAt.toISOString(),
        period_expires_at: expiresAt.toISOString(),
      }),
    ],
  );
  return rows[0]!.id;
}

export async function removeDemoPayments(): Promise<void> {
  await db().query(
    `DELETE FROM payments WHERE business_id = (SELECT id FROM businesses WHERE name = 'Demo South Cafe')`,
  );
}

export async function demoSubscriptionStatus(): Promise<string> {
  const { rows } = await db().query<{ status: string }>(
    `SELECT s.status FROM subscriptions s JOIN businesses b ON b.id = s.business_id
      WHERE b.name = 'Demo South Cafe'`,
  );
  return rows[0]?.status ?? 'MISSING';
}

/** The status the quota engine would write itself — set directly so a screen test need not wait for it. */
export async function setDemoSubscriptionStatus(
  status: 'FREE' | 'PRO_ACTIVE' | 'PAST_DUE' | 'EXPIRED' | 'CANCELLED',
): Promise<void> {
  await db().query(
    `UPDATE subscriptions SET status = $1
      WHERE business_id = (SELECT id FROM businesses WHERE name = 'Demo South Cafe')`,
    [status],
  );
}

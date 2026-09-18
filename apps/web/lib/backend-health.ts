import { createPoolConfig } from '@ai-review/db';
import type { Env } from '@ai-review/config';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { env } from './env';

const PROBE_TIMEOUT_MS = 3_000;

type HealthEnvironment = Pick<
  Env,
  | 'DATABASE_URL'
  | 'DATABASE_SSL'
  | 'DATABASE_SSL_ROOT_CERT'
  | 'REDIS_URL'
  | 'ANTHROPIC_API_KEY'
  | 'OPENAI_API_KEY'
  | 'GEMINI_API_KEY'
  | 'RESEND_API_KEY'
  | 'EMAIL_FROM'
  | 'RAZORPAY_KEY_ID'
  | 'RAZORPAY_KEY_SECRET'
  | 'RAZORPAY_WEBHOOK_SECRET'
>;

type ReachabilityCheck = { status: 'ok' | 'unavailable'; verified: true };
type ConfigurationCheck = { status: 'configured' | 'not_configured'; verified: false };

export interface BackendHealthSummary {
  status: 'healthy' | 'warning' | 'degraded';
  checks: {
    database: ReachabilityCheck;
    redis: ReachabilityCheck;
    ai: ConfigurationCheck;
    email: ConfigurationCheck;
    payments: ConfigurationCheck & { mode: 'live' | 'test' | 'unknown' | 'not_configured' };
  };
  warnings: ('EMAIL_NOT_CONFIGURED' | 'PAYMENTS_NOT_CONFIGURED')[];
}

/** Never returns the underlying exception: driver messages can contain connection credentials. */
async function withinDeadline<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Health probe timed out')), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Isolated read-only connection, so a failed probe cannot consume the app's shared pool. */
export async function probeDatabase(
  e: HealthEnvironment,
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<boolean> {
  let pool: Pool | undefined;
  let releaseClient: (() => void) | undefined;
  let abandoned = false;
  try {
    pool = new Pool({
      ...createPoolConfig({
        connectionString: e.DATABASE_URL,
        ssl: e.DATABASE_SSL,
        sslRootCert: e.DATABASE_SSL_ROOT_CERT,
        poolMin: 0,
        poolMax: 1,
      }),
      connectionTimeoutMillis: timeoutMs,
      query_timeout: timeoutMs,
      statement_timeout: timeoutMs,
      idleTimeoutMillis: timeoutMs,
    });
    pool.on('error', () => undefined);
    const probe = (async () => {
      const acquired = await pool!.connect();
      if (abandoned) {
        acquired.release(true);
        return false;
      }
      releaseClient = () => acquired.release(true);
      const result = await acquired.query('SELECT 1 AS ok');
      return result.rows[0]?.ok === 1;
    })();
    return await withinDeadline(probe, timeoutMs);
  } catch {
    return false;
  } finally {
    abandoned = true;
    // Destroy rather than reuse the isolated connection, including an in-flight timed-out query.
    releaseClient?.();
    if (pool) await withinDeadline(pool.end(), timeoutMs).catch(() => undefined);
  }
}

export async function probeRedis(
  e: HealthEnvironment,
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<boolean> {
  let redis: Redis | undefined;
  try {
    redis = new Redis(e.REDIS_URL, {
      lazyConnect: true,
      connectTimeout: timeoutMs,
      commandTimeout: timeoutMs,
      maxRetriesPerRequest: 0,
      retryStrategy: () => null,
      enableOfflineQueue: false,
    });
    redis.on('error', () => undefined);
    return await withinDeadline(
      (async () => {
        await redis!.connect();
        return (await redis!.ping()) === 'PONG';
      })(),
      timeoutMs,
    );
  } catch {
    return false;
  } finally {
    // disconnect() is local and immediate; QUIT could itself wait for an unreachable server.
    redis?.disconnect();
  }
}

/** Only DB SELECT 1 and Redis PING make network calls. No Ai requests, mail or payments. */
export async function checkBackendHealth(
  e: HealthEnvironment = env(),
  probes = { database: probeDatabase, redis: probeRedis },
): Promise<BackendHealthSummary> {
  const [database, redis] = await Promise.all([
    probes.database(e).catch(() => false),
    probes.redis(e).catch(() => false),
  ]);
  const ai = Boolean(e.ANTHROPIC_API_KEY || e.OPENAI_API_KEY || e.GEMINI_API_KEY);
  const email = Boolean(e.RESEND_API_KEY && e.EMAIL_FROM);
  const payments = Boolean(e.RAZORPAY_KEY_ID && e.RAZORPAY_KEY_SECRET && e.RAZORPAY_WEBHOOK_SECRET);
  const warnings: BackendHealthSummary['warnings'] = [];
  if (!email) warnings.push('EMAIL_NOT_CONFIGURED');
  if (!payments) warnings.push('PAYMENTS_NOT_CONFIGURED');
  const configured = (value: boolean): ConfigurationCheck => ({
    status: value ? 'configured' : 'not_configured',
    verified: false,
  });
  return {
    status: !database || !redis || !ai ? 'degraded' : warnings.length ? 'warning' : 'healthy',
    checks: {
      database: { status: database ? 'ok' : 'unavailable', verified: true },
      redis: { status: redis ? 'ok' : 'unavailable', verified: true },
      ai: configured(ai),
      email: configured(email),
      payments: {
        ...configured(payments),
        mode: !payments
          ? 'not_configured'
          : e.RAZORPAY_KEY_ID?.startsWith('rzp_live_')
            ? 'live'
            : e.RAZORPAY_KEY_ID?.startsWith('rzp_test_')
              ? 'test'
              : 'unknown',
      },
    },
    warnings,
  };
}

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createPool: vi.fn(),
  poolOptions: vi.fn(),
  redisOptions: vi.fn(),
  redisConnect: vi.fn(),
  redisPing: vi.fn(),
  redisDisconnect: vi.fn(),
  redisOn: vi.fn(),
}));

vi.mock('pg', () => ({
  Pool: class {
    constructor(options: unknown) {
      mocks.poolOptions(options);
      return mocks.createPool();
    }
  },
}));
vi.mock('ioredis', () => ({
  default: class {
    constructor(url: string, options: unknown) {
      mocks.redisOptions(url, options);
    }
    connect = mocks.redisConnect;
    ping = mocks.redisPing;
    disconnect = mocks.redisDisconnect;
    on = mocks.redisOn;
  },
}));

import { checkBackendHealth, probeDatabase, probeRedis } from '../backend-health';

const configured = {
  DATABASE_URL: 'postgres://private-user:private-password@private-db.example/app',
  DATABASE_SSL: 'require' as const,
  REDIS_URL: 'rediss://:private-redis-password@private-redis.example:6379',
  OPENAI_API_KEY: 'private-ai-key',
  RESEND_API_KEY: 'private-mail-key',
  EMAIL_FROM: 'private-sender@example.com',
  RAZORPAY_KEY_ID: 'rzp_live_private-payment-id',
  RAZORPAY_KEY_SECRET: 'private-payment-secret',
  RAZORPAY_WEBHOOK_SECRET: 'private-webhook-secret',
};

function databaseDouble() {
  const client = {
    query: vi.fn().mockResolvedValue({ rows: [{ ok: 1 }] }),
    release: vi.fn(),
  };
  const pool = {
    options: {} as Record<string, unknown>,
    connect: vi.fn().mockResolvedValue(client),
    end: vi.fn().mockResolvedValue(undefined),
    removeAllListeners: vi.fn(),
    on: vi.fn(),
  };
  mocks.createPool.mockReturnValue(pool);
  return { pool, client };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.redisConnect.mockResolvedValue(undefined);
  mocks.redisPing.mockResolvedValue('PONG');
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('backend health summary', () => {
  it('reports only reachability for real probes, never claims provider delivery is verified', async () => {
    const probes = {
      database: vi.fn().mockResolvedValue(true),
      redis: vi.fn().mockResolvedValue(true),
    };
    const result = await checkBackendHealth(configured, probes);
    expect(result).toEqual({
      status: 'healthy',
      checks: {
        database: { status: 'ok', verified: true },
        redis: { status: 'ok', verified: true },
        ai: { status: 'configured', verified: false },
        email: { status: 'configured', verified: false },
        payments: { status: 'configured', verified: false, mode: 'live' },
      },
      warnings: [],
    });
    expect(JSON.stringify(result)).not.toContain('private');
    expect(probes.database).toHaveBeenCalledOnce();
    expect(probes.redis).toHaveBeenCalledOnce();
  });

  it('warns about absent email and incomplete payment credentials without misreporting core health', async () => {
    const result = await checkBackendHealth(
      { ...configured, RESEND_API_KEY: undefined, RAZORPAY_WEBHOOK_SECRET: undefined },
      { database: vi.fn().mockResolvedValue(true), redis: vi.fn().mockResolvedValue(true) },
    );
    expect(result.status).toBe('warning');
    expect(result.warnings).toEqual(['EMAIL_NOT_CONFIGURED', 'PAYMENTS_NOT_CONFIGURED']);
    expect(result.checks.email).toEqual({ status: 'not_configured', verified: false });
    expect(result.checks.payments).toEqual({
      status: 'not_configured',
      verified: false,
      mode: 'not_configured',
    });
  });

  it.each(['database', 'redis'] as const)(
    'marks an unavailable %s as degraded and suppresses errors',
    async (dependency) => {
      const probes = {
        database: vi.fn().mockResolvedValue(true),
        redis: vi.fn().mockResolvedValue(true),
      };
      probes[dependency].mockRejectedValue(new Error(configured.DATABASE_URL));
      const result = await checkBackendHealth(configured, probes);
      expect(result.status).toBe('degraded');
      expect(result.checks[dependency].status).toBe('unavailable');
      expect(JSON.stringify(result)).not.toContain('private');
    },
  );

  it('marks missing Ai configuration as degraded', async () => {
    const result = await checkBackendHealth(
      { ...configured, OPENAI_API_KEY: undefined },
      { database: vi.fn().mockResolvedValue(true), redis: vi.fn().mockResolvedValue(true) },
    );
    expect(result.status).toBe('degraded');
    expect(result.checks.ai).toEqual({ status: 'not_configured', verified: false });
  });

  it.each([
    ['rzp_test_private-key', 'test'],
    ['unrecognized-private-key', 'unknown'],
  ])('reports payment key mode without revealing the key', async (key, mode) => {
    const result = await checkBackendHealth(
      { ...configured, RAZORPAY_KEY_ID: key },
      { database: vi.fn().mockResolvedValue(true), redis: vi.fn().mockResolvedValue(true) },
    );
    expect(result.checks.payments.mode).toBe(mode);
    expect(result.checks.payments.verified).toBe(false);
    expect(JSON.stringify(result)).not.toContain('private');
  });
});

describe('database probe', () => {
  it('runs only SELECT 1 through an isolated, bounded pool and closes it', async () => {
    const { pool, client } = databaseDouble();
    expect(await probeDatabase(configured, 20)).toBe(true);
    expect(mocks.poolOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        min: 0,
        max: 1,
        connectionTimeoutMillis: 20,
        query_timeout: 20,
        statement_timeout: 20,
      }),
    );
    expect(client.query).toHaveBeenCalledExactlyOnceWith('SELECT 1 AS ok');
    expect(client.release).toHaveBeenCalledExactlyOnceWith(true);
    expect(pool.end).toHaveBeenCalledOnce();
  });

  it('closes a failed query without exposing the exception', async () => {
    const { pool, client } = databaseDouble();
    client.query.mockRejectedValue(new Error(configured.DATABASE_URL));
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await probeDatabase(configured, 20)).toBe(false);
    expect(client.release).toHaveBeenCalledWith(true);
    expect(pool.end).toHaveBeenCalledOnce();
    expect(error).not.toHaveBeenCalled();
  });

  it('destroys a timed-out in-flight query', async () => {
    vi.useFakeTimers();
    const { pool, client } = databaseDouble();
    client.query.mockReturnValue(new Promise(() => undefined));
    const result = probeDatabase(configured, 20);
    await vi.advanceTimersByTimeAsync(20);
    expect(await result).toBe(false);
    expect(client.release).toHaveBeenCalledExactlyOnceWith(true);
    expect(pool.end).toHaveBeenCalledOnce();
  });

  it('releases a connection which arrives after the deadline without issuing a query', async () => {
    vi.useFakeTimers();
    const { pool, client } = databaseDouble();
    let resolveConnect!: (value: typeof client) => void;
    pool.connect.mockReturnValue(
      new Promise((resolve) => {
        resolveConnect = resolve;
      }),
    );
    const result = probeDatabase(configured, 20);
    await vi.advanceTimersByTimeAsync(20);
    expect(await result).toBe(false);
    resolveConnect(client);
    await Promise.resolve();
    expect(client.release).toHaveBeenCalledExactlyOnceWith(true);
    expect(client.query).not.toHaveBeenCalled();
  });
});

describe('Redis probe', () => {
  it('connects, pings and disconnects without retries or offline queueing', async () => {
    expect(await probeRedis(configured, 20)).toBe(true);
    expect(mocks.redisOptions).toHaveBeenCalledWith(
      configured.REDIS_URL,
      expect.objectContaining({
        connectTimeout: 20,
        commandTimeout: 20,
        maxRetriesPerRequest: 0,
        enableOfflineQueue: false,
      }),
    );
    expect(mocks.redisPing).toHaveBeenCalledOnce();
    expect(mocks.redisDisconnect).toHaveBeenCalledOnce();
  });

  it('does not accept an unexpected ping result', async () => {
    mocks.redisPing.mockResolvedValue('OTHER');
    expect(await probeRedis(configured, 20)).toBe(false);
    expect(mocks.redisDisconnect).toHaveBeenCalledOnce();
  });

  it('cleans up after a connection failure without logging credentials', async () => {
    mocks.redisConnect.mockRejectedValue(new Error(configured.REDIS_URL));
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await probeRedis(configured, 20)).toBe(false);
    expect(mocks.redisPing).not.toHaveBeenCalled();
    expect(mocks.redisDisconnect).toHaveBeenCalledOnce();
    expect(error).not.toHaveBeenCalled();
  });

  it('disconnects after a ping deadline', async () => {
    vi.useFakeTimers();
    mocks.redisPing.mockReturnValue(new Promise(() => undefined));
    const result = probeRedis(configured, 20);
    await vi.advanceTimersByTimeAsync(20);
    expect(await result).toBe(false);
    expect(mocks.redisDisconnect).toHaveBeenCalledOnce();
  });
});

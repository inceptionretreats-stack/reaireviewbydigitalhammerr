import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  poolConfig: vi.fn(),
  end: vi.fn().mockResolvedValue(undefined),
  migrate: vi.fn().mockResolvedValue(undefined),
  drizzle: vi.fn((pool: unknown) => ({ pool })),
}));

vi.mock('pg', () => ({
  Pool: class {
    constructor(config: unknown) {
      mocks.poolConfig(config);
    }
    end = mocks.end;
  },
}));
vi.mock('drizzle-orm/node-postgres', () => ({ drizzle: mocks.drizzle }));
vi.mock('drizzle-orm/node-postgres/migrator', () => ({ migrate: mocks.migrate }));

import { runMigrations } from '../migrate';

describe('migration runner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.migrate.mockResolvedValue(undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  it('uses the administrative URL with the same explicit TLS policy as the runtime', async () => {
    await runMigrations({
      DATABASE_URL: 'postgresql://fixture:fixture@runtime.example:6543/postgres',
      DIRECT_DATABASE_URL:
        'postgresql://fixture:fixture@migration.example:5432/postgres?sslmode=disable',
      DATABASE_SSL: 'verify-full',
      DATABASE_SSL_ROOT_CERT: 'fixture-ca',
    });

    expect(mocks.poolConfig).toHaveBeenCalledWith({
      connectionString: 'postgresql://fixture:fixture@migration.example:5432/postgres',
      min: 0,
      max: 1,
      ssl: { rejectUnauthorized: true, ca: 'fixture-ca' },
    });
    expect(mocks.migrate).toHaveBeenCalledWith(expect.anything(), {
      migrationsFolder: expect.stringMatching(/packages[/\\]db[/\\]drizzle$/),
    });
    expect(mocks.end).toHaveBeenCalledOnce();
  });

  it('closes the pool and preserves a migration failure', async () => {
    const failure = new Error('fixture migration failure');
    mocks.migrate.mockRejectedValueOnce(failure);

    await expect(
      runMigrations({ DATABASE_URL: 'postgresql://fixture:fixture@localhost/test' }),
    ).rejects.toBe(failure);
    expect(mocks.end).toHaveBeenCalledOnce();
  });

  it('rejects missing configuration before constructing a pool', async () => {
    await expect(runMigrations({})).rejects.toThrow('DIRECT_DATABASE_URL or DATABASE_URL');
    expect(mocks.poolConfig).not.toHaveBeenCalled();
  });
});

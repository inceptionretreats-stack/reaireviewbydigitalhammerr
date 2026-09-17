import { describe, expect, it } from 'vitest';
import { createPoolConfig, migrationDatabaseConfig } from '../connection';

const remote =
  'postgresql://postgres.example:fixture-password@aws-0-example.pooler.supabase.com:6543/postgres';

describe('database connection configuration', () => {
  it.each(['localhost', '127.0.0.1', '[::1]'])('disables TLS for local host %s', (host) => {
    expect(
      createPoolConfig({ connectionString: `postgresql://fixture:fixture@${host}:5432/test` }).ssl,
    ).toBe(false);
  });

  it('requires encrypted transport for a remote URL without TLS parameters', () => {
    expect(createPoolConfig({ connectionString: remote }).ssl).toEqual({
      rejectUnauthorized: false,
    });
  });

  it('keeps remote transport encrypted when a URL only sets the compatibility flag', () => {
    expect(createPoolConfig({ connectionString: `${remote}?uselibpqcompat=true` }).ssl).toEqual({
      rejectUnauthorized: false,
    });
  });

  it('preserves URL-only TLS settings for the driver', () => {
    const connectionString = `${remote}?sslmode=verify-full&sslrootcert=%2Ftmp%2Ffixture-ca.pem`;
    const config = createPoolConfig({ connectionString });
    expect(config.connectionString).toBe(connectionString);
    expect(config).not.toHaveProperty('ssl');
  });

  it('prevents URL flags from replacing an explicitly verified TLS configuration', () => {
    const config = createPoolConfig({
      connectionString: `${remote}?sslmode=disable&ssl=no-verify&sslrootcert=wrong.pem&sslnegotiation=direct&uselibpqcompat=true&application_name=migrator`,
      ssl: 'verify-full',
      sslRootCert: 'fixture-ca',
    });
    expect(config.ssl).toEqual({ rejectUnauthorized: true, ca: 'fixture-ca' });
    const url = new URL(config.connectionString!);
    expect(url.searchParams.get('application_name')).toBe('migrator');
    expect([...url.searchParams.keys()]).toEqual(['application_name']);
    expect(url.password).toBe('fixture-password');
  });

  it('enables verification when a CA is supplied without a mode', () => {
    expect(createPoolConfig({ connectionString: remote, sslRootCert: 'fixture-ca' }).ssl).toEqual({
      rejectUnauthorized: true,
      ca: 'fixture-ca',
    });
  });

  it('requires a nonblank CA for explicitly verified TLS', () => {
    expect(() => createPoolConfig({ connectionString: remote, ssl: 'verify-full' })).toThrow(
      'requires sslRootCert',
    );
    expect(() =>
      createPoolConfig({ connectionString: remote, ssl: 'verify-full', sslRootCert: '  ' }),
    ).toThrow('requires sslRootCert');
  });

  it('honors an explicit TLS disable without leaving a URL override behind', () => {
    const config = createPoolConfig({
      connectionString: `${remote}?sslmode=require`,
      ssl: 'disable',
    });
    expect(config.ssl).toBe(false);
    expect(new URL(config.connectionString!).searchParams.has('sslmode')).toBe(false);
  });

  it('supports a serverless pool of one without an oversized implicit minimum', () => {
    expect(createPoolConfig({ connectionString: remote, poolMax: 1 })).toMatchObject({
      min: 1,
      max: 1,
    });
    expect(createPoolConfig({ connectionString: remote, poolMin: 0, poolMax: 1 })).toMatchObject({
      min: 0,
      max: 1,
    });
  });

  it.each([{ poolMin: 2, poolMax: 1 }, { poolMin: -1 }, { poolMax: 0 }, { poolMax: 1.5 }])(
    'rejects invalid pool settings %j',
    (sizes) => {
      expect(() => createPoolConfig({ connectionString: remote, ...sizes })).toThrow(
        'Database pool sizes',
      );
    },
  );

  it('does not include malformed credentials in validation errors', () => {
    expect(() => createPoolConfig({ connectionString: 'not-a-url fixture-private-value' })).toThrow(
      'Database connection URL must be a valid PostgreSQL URL.',
    );
    expect(() =>
      createPoolConfig({ connectionString: 'https://fixture:fixture@example.com' }),
    ).toThrow('Database connection URL must use postgres:// or postgresql://.');
  });

  it('rejects an invalid or redacted TLS mode instead of silently disabling encryption', () => {
    expect(() =>
      createPoolConfig({ connectionString: remote, ssl: '[SENSITIVE]' as 'require' }),
    ).toThrow('Database TLS mode must be disable, require, or verify-full.');
  });
});

describe('migration connection selection', () => {
  it('selects the direct/session URL and shared TLS options with a single connection', () => {
    const config = migrationDatabaseConfig({
      DATABASE_URL: remote,
      DIRECT_DATABASE_URL: remote.replace(':6543/', ':5432/'),
      DATABASE_SSL: 'verify-full',
      DATABASE_SSL_ROOT_CERT: 'fixture-ca',
      DATABASE_POOL_MAX: '20',
    });
    expect(config).toEqual({
      connectionString: remote.replace(':6543/', ':5432/'),
      ssl: 'verify-full',
      sslRootCert: 'fixture-ca',
      poolMin: 0,
      poolMax: 1,
    });
  });

  it('falls back to DATABASE_URL when the direct URL is absent or blank', () => {
    expect(migrationDatabaseConfig({ DATABASE_URL: remote }).connectionString).toBe(remote);
    expect(
      migrationDatabaseConfig({ DATABASE_URL: remote, DIRECT_DATABASE_URL: '  ' }).connectionString,
    ).toBe(remote);
  });

  it('fails clearly when the URL or TLS mode is invalid', () => {
    expect(() => migrationDatabaseConfig({})).toThrow(
      'DIRECT_DATABASE_URL or DATABASE_URL is required',
    );
    expect(() =>
      migrationDatabaseConfig({ DATABASE_URL: remote, DATABASE_SSL: 'invalid-secret-value' }),
    ).toThrow('DATABASE_SSL must be disable, require, or verify-full.');
  });
});

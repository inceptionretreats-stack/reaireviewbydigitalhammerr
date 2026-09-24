import { describe, expect, it } from 'vitest';
import { isUniqueViolation, postgresErrorCode, safeError } from '../safe-error';

describe('safe operational errors', () => {
  it('recognizes a direct PostgreSQL unique violation', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
  });

  it('recognizes a Drizzle-wrapped and multiply wrapped unique violation', () => {
    const driver = Object.assign(new Error('email already exists'), { code: '23505' });
    const drizzle = new Error('Failed query with sensitive parameters', { cause: driver });
    expect(isUniqueViolation(drizzle)).toBe(true);
    expect(isUniqueViolation(new Error('outer', { cause: drizzle }))).toBe(true);
    expect(postgresErrorCode(drizzle)).toBe('23505');
  });

  it.each([null, undefined, '23505', { code: '23503' }, new Error('23505')])(
    'does not classify arbitrary error input as a duplicate: %j',
    (error) => expect(isUniqueViolation(error)).toBe(false),
  );

  it('logs only the SQLSTATE, never query text, parameters, name, message or stack', () => {
    const error = Object.assign(new Error('insert values user@example.com, $argon2id$secret'), {
      name: 'user@example.com',
      params: ['secret-token'],
      cause: { code: '23505', detail: 'email=user@example.com' },
    });
    expect(safeError(error)).toBe('database_error (23505)');
    expect(safeError(error)).not.toMatch(/user@|argon2|secret|insert/);
  });

  it('logs allowlisted network codes through an ORM wrapper', () => {
    const error = new Error('postgresql://user:secret@example.com/database', {
      cause: Object.assign(new Error('database host'), { code: 'ECONNRESET' }),
    });
    expect(safeError(error)).toBe('network_error (ECONNRESET)');
  });

  it('does not log arbitrary codes or error messages', () => {
    expect(safeError(Object.assign(new Error('secret'), { code: 'token=secret' }))).toBe('error');
    expect(safeError('user@example.com')).toBe('unknown_error');
  });

  it('terminates circular error chains', () => {
    const error: { cause?: unknown } = {};
    error.cause = error;
    expect(isUniqueViolation(error)).toBe(false);
    expect(safeError(error)).toBe('unknown_error');
  });

  it('does not fail while reading unusual throwing error properties', () => {
    const error = Object.defineProperties(new Error('secret'), {
      cause: {
        get: () => {
          throw new Error('private cause');
        },
      },
      code: {
        get: () => {
          throw new Error('private code');
        },
      },
    });
    expect(isUniqueViolation(error)).toBe(false);
    expect(safeError(error)).toBe('error');
  });

  it('bounds traversal of excessive wrapping', () => {
    let error: unknown = { code: '23505' };
    for (let index = 0; index < 20; index++) error = { cause: error };
    expect(isUniqueViolation(error)).toBe(false);
    expect(safeError(error)).toBe('unknown_error');
  });
});

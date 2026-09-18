import { describe, expect, it } from 'vitest';
import { cronAuthorised } from '../auth';

describe('cronAuthorised', () => {
  it('accepts only the exact bearer, and says why otherwise', () => {
    expect(cronAuthorised('Bearer s3cret', 's3cret')).toBe('ok');
    expect(cronAuthorised('bearer s3cret', 's3cret')).toBe('ok');
    expect(cronAuthorised('Bearer s3cre', 's3cret')).toBe('wrong');
    expect(cronAuthorised('Bearer s3cret2', 's3cret')).toBe('wrong');
    expect(cronAuthorised('s3cret', 's3cret')).toBe('wrong');
    expect(cronAuthorised('Basic s3cret', 's3cret')).toBe('wrong');
    expect(cronAuthorised(null, 's3cret')).toBe('wrong');
    expect(cronAuthorised('', 's3cret')).toBe('wrong');
    expect(cronAuthorised('Bearer s3cret', undefined)).toBe('unset');
    expect(cronAuthorised('Bearer ', '')).toBe('unset');
  });
});

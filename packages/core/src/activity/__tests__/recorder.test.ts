import { describe, expect, it, vi } from 'vitest';
import { ACTIVITY_ACTIONS, isActivityAction } from '../actions';
import { ActivityRecorder, sanitiseMetadata } from '../recorder';

describe('ActivityRecorder', () => {
  it('never rejects, and reports the failure to the hook instead', async () => {
    const onError = vi.fn();
    const executor = {
      insert: () => ({
        values: async () => {
          throw new Error('table is on fire');
        },
      }),
    } as never;
    await expect(
      new ActivityRecorder(executor, { onError }).record({ userId: 'u', action: 'auth.login' }),
    ).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ action: 'auth.login' }),
    );
  });

  it('survives a hook that throws', async () => {
    const executor = {
      insert: () => ({
        values: async () => {
          throw new Error('x');
        },
      }),
    } as never;
    await expect(
      new ActivityRecorder(executor, {
        onError: () => {
          throw new Error('the hook is broken too');
        },
      }).record({ userId: null, action: 'auth.signup' }),
    ).resolves.toBeUndefined();
  });

  it('defaults the outcome, bounds the user agent and sanitises the metadata', async () => {
    const values = vi.fn(async () => undefined);
    const executor = { insert: () => ({ values }) } as never;
    await new ActivityRecorder(executor).record({
      userId: 'u',
      action: 'account.update',
      userAgent: 'x'.repeat(1000),
      metadata: { password: 'nope', reset_token: 'nope', ok: 'fine' },
    });
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'SUCCESS',
        userAgent: 'x'.repeat(400),
        metadata: { ok: 'fine' },
      }),
    );
  });
});

describe('sanitiseMetadata', () => {
  it('drops secret-looking keys, cuts long strings, flattens depth and caps the key count', () => {
    const big: Record<string, unknown> = {};
    for (let i = 0; i < 60; i += 1) big[`k${i}`] = i;
    const out = sanitiseMetadata({
      ...big,
      session_token: 'abc',
      authorization: 'Bearer x',
      long: 'y'.repeat(600),
      nested: { password: 'p', name: 'n' },
      list: [1, { a: 1 }, 'z'],
      when: new Date('2026-01-01T00:00:00Z'),
      fn: () => 1,
    });
    expect(Object.keys(out)).toHaveLength(40);
    expect(out).not.toHaveProperty('session_token');
    expect(out).not.toHaveProperty('authorization');
    expect(sanitiseMetadata({ long: 'y'.repeat(600) }).long).toHaveLength(501);
    expect(sanitiseMetadata({ nested: { password: 'p', name: 'n' } }).nested).toEqual(['name']);
    expect(sanitiseMetadata({ list: [1, { a: 1 }, 'z'] }).list).toEqual([1, '[object]', 'z']);
    expect(sanitiseMetadata({ when: new Date('2026-01-01T00:00:00Z') }).when).toBe(
      '2026-01-01T00:00:00.000Z',
    );
    expect(sanitiseMetadata({ fn: () => 1 })).toEqual({});
    expect(sanitiseMetadata(undefined)).toEqual({});
  });
});

describe('ACTIVITY_ACTIONS', () => {
  it('is unique, dotted lowercase, and closed', () => {
    expect(new Set(ACTIVITY_ACTIONS).size).toBe(ACTIVITY_ACTIONS.length);
    for (const action of ACTIVITY_ACTIONS) expect(action).toMatch(/^[a-z_]+(\.[a-z_]+)+$/);
    expect(isActivityAction('auth.login')).toBe(true);
    expect(isActivityAction('auth.made_up')).toBe(false);
  });
});

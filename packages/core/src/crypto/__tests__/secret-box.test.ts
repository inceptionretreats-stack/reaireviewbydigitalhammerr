import { describe, expect, it } from 'vitest';
import { SecretBox, SecretBoxError } from '../secret-box';

const KEY = 'a-master-key-that-is-at-least-thirty-two-characters';

describe('SecretBox', () => {
  it('round-trips a secret bound to its row', () => {
    const box = new SecretBox(KEY);
    const secret = Uint8Array.from([1, 2, 3, 4, 5, 250, 251, 252]);
    const sealed = box.seal(secret, 'mfa:user-1');
    expect(sealed.startsWith('v1.')).toBe(true);
    expect(box.open(sealed, 'mfa:user-1')).toEqual(secret);
  });

  it('never produces the same ciphertext twice', () => {
    const box = new SecretBox(KEY);
    const secret = Uint8Array.from([9, 9, 9]);
    expect(box.seal(secret, 'a')).not.toBe(box.seal(secret, 'a'));
  });

  it('refuses a ciphertext moved to another row, a tampered tag, a foreign key and a bad format', () => {
    const box = new SecretBox(KEY);
    const sealed = box.seal(Uint8Array.from([7]), 'mfa:user-1');
    expect(() => box.open(sealed, 'mfa:user-2')).toThrow(SecretBoxError);

    const parts = sealed.split('.');
    parts[3] = parts[3]!.replace(/^./, (c) => (c === 'A' ? 'B' : 'A'));
    expect(() => box.open(parts.join('.'), 'mfa:user-1')).toThrow(SecretBoxError);

    expect(() =>
      new SecretBox('another-master-key-with-32-chars-min').open(sealed, 'mfa:user-1'),
    ).toThrow(SecretBoxError);
    expect(() => box.open('v9.a.b.c', 'mfa:user-1')).toThrow(SecretBoxError);
    expect(() => box.open('garbage', 'mfa:user-1')).toThrow(SecretBoxError);
  });

  it('insists on a real master key', () => {
    expect(() => new SecretBox('short')).toThrow(SecretBoxError);
  });
});

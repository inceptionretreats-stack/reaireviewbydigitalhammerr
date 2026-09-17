import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

/**
 * Sealing for secrets the application must be able to read back — today the TOTP seed behind
 * admin MFA (AMENDMENT-027). A password hash is one-way; a TOTP seed is not, so it is
 * encrypted at rest under a key derived from `APP_ENCRYPTION_KEY`, which lives in the
 * environment and never in the database.
 *
 * AES-256-GCM with a random 96-bit nonce per seal and the row's identity as associated data,
 * so a ciphertext copied onto another user's row fails to open. The `v1.` prefix is the
 * version: rotating the master key means re-sealing (for MFA, re-enrolling) — a `v2.` prefix
 * would let both keys be honoured during a rotation.
 */

const VERSION = 'v1';
const INFO = 'ai-review/secret-box/v1';

export class SecretBoxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretBoxError';
  }
}

export class SecretBox {
  private readonly key: Buffer;

  constructor(masterKey: string) {
    if (masterKey.length < 32)
      throw new SecretBoxError('master key must be at least 32 characters');
    this.key = Buffer.from(hkdfSync('sha256', masterKey, '', INFO, 32));
  }

  seal(plaintext: Uint8Array, aad: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(aad, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(Buffer.from(plaintext)), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [VERSION, b64(iv), b64(ciphertext), b64(tag)].join('.');
  }

  open(sealed: string, aad: string): Uint8Array {
    const parts = sealed.split('.');
    if (parts.length !== 4 || parts[0] !== VERSION) {
      throw new SecretBoxError('unknown sealed format');
    }
    const [, ivText, ciphertextText, tagText] = parts as [string, string, string, string];
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivText, 'base64url'));
      decipher.setAAD(Buffer.from(aad, 'utf8'));
      decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
      return new Uint8Array(
        Buffer.concat([
          decipher.update(Buffer.from(ciphertextText, 'base64url')),
          decipher.final(),
        ]),
      );
    } catch {
      throw new SecretBoxError('sealed value did not open');
    }
  }
}

function b64(bytes: Buffer): string {
  return bytes.toString('base64url');
}

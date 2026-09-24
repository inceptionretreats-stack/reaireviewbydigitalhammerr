import { PasswordHasher } from '@ai-review/core';
import { env } from '@/lib/infra/env';

let hasher: PasswordHasher | undefined;

/**
 * Argon2id hasher, constructed once.
 *
 * The pepper is a server-side secret mixed into every hash, so a stolen database of hashes is
 * not offline-crackable without also stealing the application secret
 * (13_Security_Privacy_Compliance.md).
 */
export function passwordHasher(): PasswordHasher {
  hasher ??= new PasswordHasher({ pepper: env().HASH_PEPPER });
  return hasher;
}

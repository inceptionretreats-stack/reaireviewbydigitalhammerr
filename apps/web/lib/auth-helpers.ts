import { PasswordHasher } from '@ai-review/core';
import { env } from './env';

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

/**
 * Placeholder identity for the business shell created at signup (AUTH-01-01).
 *
 * businesses.name and .category are NOT NULL, but signup collects neither — the screen spec
 * puts them on ONB-01. The shell therefore carries placeholders, which is safe because the row
 * is DRAFT and every public surface gates on status = 'ACTIVE'. The publish transaction is
 * where these must be real, and it refuses to publish while they are not.
 */
// Re-exported from lib/tenant-shell so server call sites need no change. The definitions moved
// because this module value-imports PasswordHasher, and a client component importing isShell from
// here would drag a native crypto module toward the browser bundle.
export { SHELL_CATEGORY, isShell, shellBusinessName } from './tenant-shell';

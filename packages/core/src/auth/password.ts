import { hash, verify } from '@node-rs/argon2';

/**
 * Argon2id password hashing (13_Security_Privacy_Compliance.md).
 *
 * Parameters follow OWASP's second recommended configuration: 19 MiB memory, 2 iterations,
 * 1 degree of parallelism. "Environment-calibrated cost" in the spec means these should be
 * re-timed on the production instance class; they are read from config so that is a settings
 * change rather than a deploy.
 */
export interface PasswordHasherOptions {
  memoryCost?: number;
  timeCost?: number;
  parallelism?: number;
  /** Server-side secret mixed into every hash (HASH_PEPPER). */
  pepper?: string;
}

const DEFAULTS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 256;

export type PasswordRejection = 'TOO_SHORT' | 'TOO_LONG' | 'TOO_COMMON' | 'NOT_ENOUGH_VARIETY';

/**
 * A short deny-list of passwords that meet the length rule but are guessed first. Not a
 * substitute for a breach-corpus check, which belongs in E13.
 */
const COMMON_PASSWORDS = new Set([
  'password1234',
  'passwordpassword',
  '123456789012',
  'qwertyuiop12',
  'digitalhammerr',
  'aireviewaireview',
]);

export function validatePasswordStrength(
  password: string,
): { ok: true } | { ok: false; reason: PasswordRejection } {
  if (password.length < PASSWORD_MIN_LENGTH) return { ok: false, reason: 'TOO_SHORT' };
  if (password.length > PASSWORD_MAX_LENGTH) return { ok: false, reason: 'TOO_LONG' };
  if (COMMON_PASSWORDS.has(password.toLowerCase())) return { ok: false, reason: 'TOO_COMMON' };

  // A single repeated character satisfies any length rule; require some variety.
  if (new Set(password).size < 5) return { ok: false, reason: 'NOT_ENOUGH_VARIETY' };

  return { ok: true };
}

export class PasswordHasher {
  private readonly options: Required<Omit<PasswordHasherOptions, 'pepper'>>;
  private readonly pepper: string;

  constructor(options: PasswordHasherOptions = {}) {
    this.options = {
      memoryCost: options.memoryCost ?? DEFAULTS.memoryCost,
      timeCost: options.timeCost ?? DEFAULTS.timeCost,
      parallelism: options.parallelism ?? DEFAULTS.parallelism,
    };
    this.pepper = options.pepper ?? '';
  }

  async hash(password: string): Promise<string> {
    return hash(this.season(password), this.options);
  }

  /**
   * Returns false rather than throwing on a malformed stored hash, so a corrupted row denies
   * access instead of returning a 500 that distinguishes it from a wrong password.
   */
  async verify(storedHash: string, password: string): Promise<boolean> {
    try {
      return await verify(storedHash, this.season(password));
    } catch {
      return false;
    }
  }

  private season(password: string): string {
    return this.pepper ? `${password}${this.pepper}` : password;
  }
}

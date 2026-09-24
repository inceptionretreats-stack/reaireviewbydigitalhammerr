import { createHash, randomBytes } from 'node:crypto';

/**
 * Opaque token issue-and-verify, shared by sessions, password resets, invites and manual
 * review-request tracking links.
 *
 * In every case the database stores only the SHA-256 of the token, never the token itself, so
 * a database disclosure does not hand over live sessions or usable reset links. The plaintext
 * exists only in the response that issues it.
 */

const DEFAULT_TOKEN_BYTES = 32;

export interface IssuedToken {
  /** Returned to the client exactly once. */
  token: string;
  /** Stored. char(64) in every consuming table. */
  tokenHash: string;
}

export function issueToken(bytes = DEFAULT_TOKEN_BYTES): IssuedToken {
  const token = randomBytes(bytes).toString('base64url');
  return { token, tokenHash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Privacy-preserving hash for analytics and abuse signals.
 *
 * 13_Security_Privacy_Compliance.md requires that raw IPs are not retained as analytics
 * identity. The pepper stops the output being a rainbow-table lookup of the input.
 */
export function privacyHash(value: string, pepper: string): string {
  return createHash('sha256').update(`${pepper}:${value}`).digest('hex');
}

/**
 * Truncates an IP to a prefix before hashing — /24 for IPv4, /48 for IPv6 — so rate limiting
 * and abuse detection work at network granularity without storing an individual address.
 */
export function ipPrefixHash(ip: string, pepper: string): string {
  const prefix = ip.includes(':')
    ? ip.split(':').slice(0, 3).join(':')
    : ip.split('.').slice(0, 3).join('.');
  return privacyHash(prefix, pepper);
}

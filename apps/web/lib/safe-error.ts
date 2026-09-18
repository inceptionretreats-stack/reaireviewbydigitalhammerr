/**
 * Safe operational diagnostics: never serialize an Error, its message, stack or parameters.
 * Drizzle includes SQL and bound values in its message and wraps the PostgreSQL error in
 * `cause`, so even logging only `error.message` can disclose passwords, tokens or customer data.
 */
const NETWORK_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_SOCKET',
]);

/** Bound traversal and detect cycles: errors from third-party libraries are not a schema. */
function errorChain(error: unknown): unknown[] {
  const chain: unknown[] = [];
  let current = error;
  while (current !== null && typeof current === 'object' && chain.length < 8) {
    if (chain.includes(current)) break;
    chain.push(current);
    current = property(current, 'cause');
  }
  return chain;
}

function property(value: unknown, key: string): unknown {
  if (value === null || typeof value !== 'object') return undefined;
  try {
    return Reflect.get(value, key);
  } catch {
    return undefined;
  }
}

/** Only numeric-class SQLSTATEs used by our driver diagnostics are retained; others are omitted. */
export function postgresErrorCode(error: unknown): string | undefined {
  for (const item of errorChain(error)) {
    const code = property(item, 'code');
    if (typeof code === 'string' && /^[0-9][0-9A-Z]{4}$/.test(code)) return code;
  }
  return undefined;
}

export function isUniqueViolation(error: unknown): boolean {
  return errorChain(error).some((item) => property(item, 'code') === '23505');
}

/** Only fixed labels and bounded machine codes reach logs; arbitrary names are excluded too. */
export function safeError(error: unknown): string {
  const databaseCode = postgresErrorCode(error);
  if (databaseCode) return `database_error (${databaseCode})`;
  for (const item of errorChain(error)) {
    const code = property(item, 'code');
    if (typeof code === 'string' && NETWORK_CODES.has(code)) return `network_error (${code})`;
  }
  return error instanceof Error ? 'error' : 'unknown_error';
}

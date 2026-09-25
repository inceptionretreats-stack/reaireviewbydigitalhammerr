import { loadEnv, type Env } from '@ai-review/config';

let cached: Env | undefined;

/**
 * Validated environment, loaded once per process.
 *
 * Server-only: importing this from a client component would be a build error, which is the
 * boundary that keeps provider keys and payment secrets out of the browser bundle
 * (16_Repository_Folder_Structure.md, AC-030).
 */
export function env(): Env {
  cached ??= loadEnv();
  return cached;
}

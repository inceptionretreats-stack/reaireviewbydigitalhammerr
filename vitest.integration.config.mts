import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Integration suite — everything that needs a real PostgreSQL.
 *
 * Kept in its own config, selected by PATH rather than by test-name pattern. The previous CI
 * job used `--testNamePattern integration`, which matched none of the six unit-test files: it
 * started Postgres, ran the migration, selected zero tests and reported success. A green
 * pipeline that asserts nothing is worse than no pipeline, because it is trusted.
 *
 * passWithNoTests is explicitly false so an empty selection fails loudly.
 */
/**
 * These suites connect to a real database and every one of them fails loudly without
 * DATABASE_URL. Vitest does not read .env into process.env on its own, so `pnpm test:integration`
 * only worked for someone who happened to have exported it by hand — a documented script looking
 * broken on a machine where the database was in fact running.
 *
 * Like `node --env-file`, this does not overwrite a variable that is already set, so CI's real
 * environment still wins. CI has no .env file at all, which is why a missing one is not an error.
 */
try {
  process.loadEnvFile('.env');
} catch {
  // No .env — CI, or a checkout that has not been configured yet. The suites report the missing
  // variable themselves, and more clearly than this would.
}

export default defineConfig({
  // Same `@/` mapping as apps/web/tsconfig.json; see vitest.config.mts.
  resolve: {
    alias: { '@': fileURLToPath(new URL('./apps/web', import.meta.url)) },
  },
  test: {
    include: ['**/__tests__/integration/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**'],
    passWithNoTests: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Shared schema, so suites must not race each other's fixtures.
    fileParallelism: false,
  },
});

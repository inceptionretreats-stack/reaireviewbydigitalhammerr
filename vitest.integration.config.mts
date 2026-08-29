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
export default defineConfig({
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

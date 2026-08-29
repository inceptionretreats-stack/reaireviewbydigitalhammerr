import { defineConfig } from 'vitest/config';

/**
 * Unit suite — pure functions and in-memory doubles only, no external services.
 *
 * The integration directory is excluded here and selected by vitest.integration.config.ts, so
 * `pnpm test` stays runnable on a laptop with no database while integration failures cannot
 * hide behind a skip.
 */
export default defineConfig({
  test: {
    include: ['**/__tests__/**/*.test.ts', '**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**', '**/__tests__/integration/**'],
    passWithNoTests: false,
  },
});

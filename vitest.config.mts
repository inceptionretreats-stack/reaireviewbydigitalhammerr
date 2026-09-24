import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Unit suite — pure functions and in-memory doubles only, no external services.
 *
 * The integration directory is excluded here and selected by vitest.integration.config.mts, so
 * `pnpm test` stays runnable on a laptop with no database while integration failures cannot
 * hide behind a skip.
 *
 * `@/` resolves to apps/web exactly as apps/web/tsconfig.json maps it, so a module and its test
 * can import through the alias and neither depends on how deep its folder sits.
 */
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./apps/web', import.meta.url)) },
  },
  test: {
    include: ['**/__tests__/**/*.test.ts', '**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**', '**/__tests__/integration/**'],
    passWithNoTests: false,
  },
});

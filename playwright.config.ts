import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end suite (12_QA_Acceptance_Criteria.md "Required automated test suites").
 *
 * Runs against the locally installed Chrome rather than a downloaded build: Playwright's own
 * browser download fails on this machine, and the installed browser is what the product will
 * actually be used in. `channel: 'chrome'` drives it directly with no download.
 *
 * These tests need the dev server AND a migrated, seeded database:
 *   pnpm db:dev                                   (terminal 1)
 *   set -a && . ./.env && set +a
 *   pnpm db:migrate && pnpm exec tsx scripts/db/seed.ts --force
 *   pnpm --filter @ai-review/web dev              (terminal 2)
 *   pnpm e2e
 */
/**
 * The same .env the dev server booted from.
 *
 * A QR encodes APP_BASE_URL, so a test that wants to assert the payload is correct has to know
 * what that value is. Comparing against a hard-coded 'http://localhost:3000' is how the original
 * fault survived every gate: the payload matched the literal and was still unreachable from the
 * one device that matters.
 */
try {
  process.loadEnvFile('.env');
} catch {
  // No .env — CI supplies the real environment.
}

const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const testOrigin = new URL(baseURL);
const needsLocalSecureContext =
  testOrigin.protocol === 'http:' &&
  !['localhost', '127.0.0.1', '[::1]'].includes(testOrigin.hostname);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    baseURL,
    channel: 'chrome',
    headless: true,
    // A LAN-hosted dev build is intentionally reachable by the phone that scans its QR. Chromium
    // otherwise withholds the Clipboard API from that HTTP origin, making the positive copy-path
    // test exercise the app's manual fallback instead. Production remains HTTPS; this flag is
    // confined to the local browser runner.
    launchOptions: needsLocalSecureContext
      ? { args: [`--unsafely-treat-insecure-origin-as-secure=${testOrigin.origin}`] }
      : undefined,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    actionTimeout: 15_000,
  },
  projects: [
    {
      name: 'chrome',
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    },
    {
      // The customer half is mobile-first by specification (18_UI_UX_Design_System_Brief),
      // and a QR scan is by definition a phone. Testing it on a desktop viewport only would
      // miss exactly the layout the product is designed around.
      name: 'mobile',
      use: { ...devices['Pixel 7'], channel: 'chrome' },
      testMatch: /customer-.*\.spec\.ts/,
    },
  ],
});

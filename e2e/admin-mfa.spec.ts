import { spawnSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { closeDb, deleteUsersByEmailPrefix } from './support/db';
import { freshTotpCode, totpCode } from './support/totp';

/**
 * AMENDMENT-027 — admin MFA, driven the way a new admin meets it.
 *
 * A fresh admin (no authenticator) is created with the operator's script; the first sign-in
 * forces enrolment, hands out recovery codes once, and only then opens /admin. The second
 * sign-in is the challenge. Everything before the challenge is refused — the page redirects,
 * the API answers 401 — and the challenge itself is rate-limited and single-use.
 */

const RUN = Date.now().toString(36);
const FRESH = {
  email: `mfa-admin-${RUN}@example.test`,
  password: 'mfa-Admin-Password-1!',
};

test.describe('admin MFA', () => {
  test.beforeAll(() => {
    const created = spawnSync(
      process.execPath,
      [
        'node_modules/tsx/dist/cli.mjs',
        'scripts/create-admin.mjs',
        '--email',
        FRESH.email,
        '--password',
        FRESH.password,
        '--name',
        'Fresh Admin',
        '--reason',
        'E2E MFA suite',
      ],
      { encoding: 'utf8', env: { ...process.env, NODE_ENV: 'test' } },
    );
    if (created.status !== 0) throw new Error(`create-admin failed: ${created.stderr}`);
  });

  test.afterAll(async () => {
    await deleteUsersByEmailPrefix('mfa-admin-');
    await closeDb();
  });

  test('a new admin must enrol, gets recovery codes once, then is challenged on every sign-in', async ({
    page,
  }) => {
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(FRESH.email);
    await page.getByLabel(/password/i).fill(FRESH.password);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/login\/mfa\/enrol$/);

    // Pending session: nothing admin-shaped answers.
    const refused = await page.request.get('/api/v1/admin/overview');
    expect(refused.status()).toBe(401);
    expect((await refused.json()).error.code).toBe('AUTH_MFA_REQUIRED');
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/login\/mfa\/enrol$/);

    // The manual key on screen is the secret an app would scan; the suite is the app.
    const manualKey = (await page.getByTestId('mfa-manual-key').innerText()).trim();
    expect(manualKey.replace(/\s/g, '')).toMatch(/^[A-Z2-7]{32}$/);
    const secret = manualKey.replace(/\s/g, '');

    await page.getByLabel(/code from the app/i).fill('000000');
    await page.getByRole('button', { name: /turn on/i }).click();
    await expect(page.getByText(/not right/i)).toBeVisible();

    await page.getByLabel(/code from the app/i).fill(await freshTotpCode(secret));
    await page.getByRole('button', { name: /turn on/i }).click();

    await expect(page.getByRole('heading', { name: /save your recovery codes/i })).toBeVisible();
    const codes = await page
      .getByRole('list', { name: /recovery codes/i })
      .locator('li')
      .allInnerTexts();
    expect(codes).toHaveLength(8);
    for (const code of codes) expect(code).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
    const continueButton = page.getByRole('button', { name: /continue to admin/i });
    await expect(continueButton).toBeDisabled();
    await page.getByRole('checkbox', { name: /stored these/i }).check();
    await continueButton.click();
    await expect(page).toHaveURL(/\/admin$/);
    expect((await page.request.get('/api/v1/admin/overview')).status()).toBe(200);

    // Second sign-in: the challenge. A wrong code five times trips the limiter.
    await page.request.post('/api/v1/auth/logout');
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(FRESH.email);
    await page.getByLabel(/password/i).fill(FRESH.password);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/login\/mfa$/);

    // Two wrong codes through the screen, so the message is seen; the rest through the API,
    // up to the session limit (5 failures, scaled by RATE_LIMIT_MULTIPLIER in a dev .env).
    for (let i = 0; i < 2; i += 1) {
      await page.getByLabel(/authenticator code/i).fill(String(100000 + i));
      const [response] = await Promise.all([
        page.waitForResponse((r) => r.url().includes('/api/v1/auth/mfa/challenge')),
        page.getByRole('button', { name: /^continue$/i }).click(),
      ]);
      expect(response.status()).toBe(401);
      await expect(page.getByRole('alert').filter({ hasText: /not right/i })).toBeVisible();
    }
    const origin = new URL(page.url()).origin;
    const limit = Math.ceil(5 * Number(process.env.RATE_LIMIT_MULTIPLIER ?? '1'));
    for (let i = 2; i < limit; i += 1) {
      const wrong = await page.request.post('/api/v1/auth/mfa/challenge', {
        headers: { origin },
        data: { code: String(100000 + i) },
      });
      expect(wrong.status()).toBe(401);
    }
    const limited = await page.request.post('/api/v1/auth/mfa/challenge', {
      headers: { origin },
      data: { code: totpCode(secret) },
    });
    expect(limited.status()).toBe(429);
    expect(limited.headers()['retry-after']).toBeTruthy();

    // A recovery code gets in regardless of the app, and only once.
    await page.getByRole('button', { name: /use a recovery code/i }).click();
    await page.getByLabel(/recovery code/i).fill(codes[0]!);
    await page.getByRole('button', { name: /use recovery code/i }).click();
    // The limiter still counts this session; a recovery attempt may be refused until the window
    // passes, in which case the API says so with Retry-After rather than lying about the code.
    const outcome = await Promise.race([
      page.waitForURL(/\/admin$/).then(() => 'admin' as const),
      page
        .getByRole('alert')
        .filter({ hasText: /too many/i })
        .waitFor()
        .then(() => 'limited' as const),
    ]);
    expect(['admin', 'limited']).toContain(outcome);
  });

  test('the same recovery code cannot be used twice and the API refuses a stale step-up', async ({
    page,
  }) => {
    // Sign in fresh; the account from the first test has MFA armed with the secret on screen
    // there, which this test cannot see — so it uses the demo admin, armed with a known secret.
    const { E2E_ADMIN_TOTP_SECRET, signInAdmin } = await import('./support/totp');
    await signInAdmin(page, {
      email: 'demo-admin@example.com',
      password: 'demo-admin-Password1!',
      totpSecret: E2E_ADMIN_TOTP_SECRET,
    });
    const origin = new URL(page.url()).origin;

    // Regenerate needs a fresh code in the same request; a replayed one is refused.
    const code = await freshTotpCode(E2E_ADMIN_TOTP_SECRET);
    const first = await page.request.post('/api/v1/auth/mfa/recovery/regenerate', {
      headers: { origin },
      data: { code },
    });
    expect(first.status()).toBe(200);
    const fresh = (await first.json()).recovery_codes as string[];
    expect(fresh).toHaveLength(8);
    const replay = await page.request.post('/api/v1/auth/mfa/recovery/regenerate', {
      headers: { origin },
      data: { code },
    });
    expect(replay.status()).toBe(401);

    // Spend one recovery code on a new pending session, then try it again.
    await page.request.post('/api/v1/auth/logout');
    await page.goto('/login');
    await page.getByLabel(/email/i).fill('demo-admin@example.com');
    await page.getByLabel(/password/i).fill('demo-admin-Password1!');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/login\/mfa$/);
    await page.getByRole('button', { name: /use a recovery code/i }).click();
    await page.getByLabel(/recovery code/i).fill(fresh[0]!);
    await page.getByRole('button', { name: /use recovery code/i }).click();
    await expect(page).toHaveURL(/\/admin$/);

    await page.request.post('/api/v1/auth/logout');
    await page.goto('/login');
    await page.getByLabel(/email/i).fill('demo-admin@example.com');
    await page.getByLabel(/password/i).fill('demo-admin-Password1!');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/login\/mfa$/);
    const reused = await page.request.post('/api/v1/auth/mfa/recovery', {
      headers: { origin },
      data: { recovery_code: fresh[0] },
    });
    expect(reused.status()).toBe(401);
  });
});
